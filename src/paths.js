'use strict';
const path=require('node:path');
const PROJECT_ROOT=path.resolve(__dirname,'..');
const fromRoot=(...parts)=>path.join(PROJECT_ROOT,...parts);
module.exports={PROJECT_ROOT,fromRoot};
