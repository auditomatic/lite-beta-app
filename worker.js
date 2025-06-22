// Web Worker for background task processing
import * as Comlink from 'https://unpkg.com/comlink/dist/esm/comlink.mjs';

class TaskProcessor {
  constructor() {
    this.activeRuns = new Map();
    this.abortControllers = new Map();
  }

  async startRun(runId, config) {
    console.log(`[Worker] Starting run ${runId}`);
    
    // Create abort controller for this run
    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);
    
    // Mark run as active
    this.activeRuns.set(runId, {
      status: 'running',
      startTime: Date.now(),
      completedTasks: 0,
      totalTasks: config.totalTasks
    });

    try {
      // Process tasks
      await this.processTasks(runId, config, abortController.signal);
      
      // Mark as completed
      const runInfo = this.activeRuns.get(runId);
      if (runInfo) {
        runInfo.status = 'completed';
        runInfo.endTime = Date.now();
      }
    } catch (error) {
      console.error(`[Worker] Error in run ${runId}:`, error);
      const runInfo = this.activeRuns.get(runId);
      if (runInfo) {
        runInfo.status = 'failed';
        runInfo.error = error.message;
      }
      throw error;
    } finally {
      // Clean up
      this.abortControllers.delete(runId);
    }
  }

  async processTasks(runId, config, signal) {
    const { tasks, parallel, onProgress, onTaskComplete } = config;
    
    // Process tasks with concurrency control
    const queue = [...tasks];
    const inProgress = new Set();
    const results = [];
    
    while (queue.length > 0 || inProgress.size > 0) {
      // Check if cancelled
      if (signal.aborted) {
        throw new Error('Run cancelled');
      }
      
      // Start new tasks up to parallel limit
      while (inProgress.size < parallel && queue.length > 0) {
        const task = queue.shift();
        const taskPromise = this.processTask(task, config)
          .then(result => {
            results.push(result);
            inProgress.delete(taskPromise);
            
            // Update progress
            const runInfo = this.activeRuns.get(runId);
            if (runInfo) {
              runInfo.completedTasks++;
              
              // Call task complete callback
              if (onTaskComplete) {
                onTaskComplete(result);
              }
              
              // Call progress callback
              if (onProgress) {
                onProgress({
                  completedTasks: runInfo.completedTasks,
                  totalTasks: runInfo.totalTasks,
                  progress: (runInfo.completedTasks / runInfo.totalTasks) * 100
                });
              }
            }
          })
          .catch(error => {
            console.error(`[Worker] Task ${task.id} failed:`, error);
            const failedTask = { 
              ...task, 
              status: 'failed',
              error: error.message,
              completedAt: new Date().toISOString()
            };
            results.push(failedTask);
            inProgress.delete(taskPromise);
            
            // Call task complete callback for failed tasks too
            if (onTaskComplete) {
              onTaskComplete(failedTask);
            }
          });
        
        inProgress.add(taskPromise);
      }
      
      // Wait for at least one task to complete
      if (inProgress.size > 0) {
        await Promise.race(inProgress);
      }
    }
    
    return results;
  }

  async processTask(task, config) {
    const { modelConfigs, corsProxy } = config;
    const modelConfig = modelConfigs[task.model];
    
    if (!modelConfig) {
      throw new Error(`Model config not found for ${task.model}`);
    }
    
    try {
      // Make API call
      const response = await this.callAPI({
        provider: modelConfig.provider,
        apiKey: modelConfig.apiKey,
        corsProxy,
        model: task.model,
        prompt: task.prompt,
        temperature: task.temperature,
        maxTokens: task.maxTokens
      });
      
      // Calculate cost
      const cost = this.calculateCost(response.usage, modelConfig.model);
      
      return {
        ...task,
        status: 'completed',
        response: response.text,
        usage: response.usage,
        cost: cost,
        completedAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`API call failed: ${error.message}`);
    }
  }

  async callAPI(params) {
    const { provider, apiKey, corsProxy, model, prompt, temperature, maxTokens } = params;
    
    // Build API URL
    let baseUrl = provider.baseUrl;
    const endpoint = provider.endpoints.chat || '/chat/completions';
    
    let url = `${baseUrl}${endpoint}`;
    if (corsProxy) {
      url = `${corsProxy}/${url}`;
    }
    
    // Build auth headers based on provider config
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (provider.authType === 'bearer') {
      headers[provider.authHeader] = `${provider.authPrefix} ${apiKey}`;
    } else if (provider.authType === 'header') {
      headers[provider.authHeader] = apiKey;
    }
    
    // Make request
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: temperature,
        max_tokens: maxTokens
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    // Parse response based on provider format
    if (!data.choices || data.choices.length === 0) {
      throw new Error('No choices in response');
    }
    
    return {
      text: data.choices[0].message.content,
      usage: data.usage
    };
  }

  calculateCost(usage, model) {
    if (!usage || !model) return null;
    
    const inputCost = (usage.prompt_tokens || 0) * (model.input_cost_per_token || 0);
    const outputCost = (usage.completion_tokens || 0) * (model.output_cost_per_token || 0);
    const totalCost = inputCost + outputCost;
    
    return {
      input_cost: inputCost,
      output_cost: outputCost,
      total_cost: totalCost,
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0
    };
  }

  stopRun(runId) {
    console.log(`[Worker] Stopping run ${runId}`);
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
    }
    
    const runInfo = this.activeRuns.get(runId);
    if (runInfo) {
      runInfo.status = 'stopped';
      runInfo.endTime = Date.now();
    }
  }

  pauseRun(runId) {
    console.log(`[Worker] Pausing run ${runId}`);
    const runInfo = this.activeRuns.get(runId);
    if (runInfo) {
      runInfo.status = 'paused';
      runInfo.pausedAt = Date.now();
    }
  }

  resumeRun(runId) {
    console.log(`[Worker] Resuming run ${runId}`);
    const runInfo = this.activeRuns.get(runId);
    if (runInfo && runInfo.status === 'paused') {
      runInfo.status = 'running';
      delete runInfo.pausedAt;
    }
  }

  getProgress(runId) {
    const runInfo = this.activeRuns.get(runId);
    if (!runInfo) return null;
    
    return {
      status: runInfo.status,
      completedTasks: runInfo.completedTasks,
      totalTasks: runInfo.totalTasks,
      progress: (runInfo.completedTasks / runInfo.totalTasks) * 100,
      startTime: runInfo.startTime,
      endTime: runInfo.endTime
    };
  }

  getActiveRuns() {
    return Array.from(this.activeRuns.keys());
  }
}

// Expose the TaskProcessor via Comlink
const processor = new TaskProcessor();
Comlink.expose(processor);