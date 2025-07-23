/*!
 * Built by Revolist OU ❤️
 */
const o="header",e="footer",t="content",s="data";function r(o,e){return{x:o.viewports[o.colType].store.get("realCount"),y:o.viewports[e].store.get("realCount")}}function i(o,e,t,s){return{colData:o.colStore,viewportCol:o.viewports[o.colType].store,viewportRow:o.viewports[e].store,lastCell:r(o,e),slot:t,type:e,canDrag:!s,position:o.position,dataStore:o.rowStores[e].store,dimensionCol:o.dimensions[o.colType].store,dimensionRow:o.dimensions[e].store,style:s?{height:`${o.dimensions[e].store.get("realSize")}px`}:void 0}}export{t as C,s as D,e as F,o as H,i as v};
