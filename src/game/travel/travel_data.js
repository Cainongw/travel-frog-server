'use strict';

// Curated from the client's Picture.json and resources.json. Keeping this
// table small gives the offline loop valid, locally available postcard art.
const TRAVEL_ROUTES = [
  {
    id: 0,
    destination: '屋顶',
    picId: 100,
    back: [1, 2, 5, 6, 8, 7, 11],
    front: [],
    frog: [190, 99, -80],
    companions: [[245, 145, -76], [298, 46, -80], [352, 42, -65]],
    specialtyId: 3000,
    noteId: 1000,
  },
  {
    id: 1,
    destination: '海边',
    picId: 103,
    back: [14, 20, 18, 19, 21],
    front: [],
    frog: [199, 10, -111],
    companions: [[253, 72, -101], [306, 69, -111], [360, 84, -58]],
    specialtyId: 3001,
    noteId: 1001,
  },
  {
    id: 2,
    destination: '树枝',
    picId: 105,
    back: [24, 25, 588, 26, 27],
    front: [],
    frog: [194, 68, -3],
    companions: [[249, 29, 6], [302, 22, 16], [356, 0, 87]],
    specialtyId: 3002,
    noteId: 1002,
  },
  {
    id: 3,
    destination: '竹林',
    picId: 107,
    back: [32, 33, 34, 35, 36, 37, 38],
    front: [47, 48],
    frog: [197, 33, -84],
    companions: [[251, 7, -100], [304, 8, -92], [358, -2, -41]],
    specialtyId: 3003,
    noteId: 1003,
  },
  {
    id: 4,
    destination: '麦田',
    picId: 109,
    back: [395, 396, 397, 398, 399],
    front: [],
    frog: [200, 39, -105],
    companions: [[254, -23, -115], [307, -13, -104], [361, -9, -92]],
    specialtyId: 3004,
    noteId: 1004,
  },
];

function selectTrip(tripNumber) {
  const index = Math.max(0, Number(tripNumber) - 1);
  const route = TRAVEL_ROUTES[index % TRAVEL_ROUTES.length];
  const companionId = [0, 1, 2, -1][index % 4];
  return { route, companionId };
}

function makePostcard(route, companionId, id) {
  // The renderer accepts top-left pixels, not Picture.json's centered, y-up
  // character coordinates. Background placement below is an offline layout;
  // the original server-only PictureBack configuration is not in this APK.
  const positions = {
    1: [0,-13], 2: [-10,0], 5: [40,30], 6: [0,140], 8: [200,126], 7: [-180,122], 11: [-377,269],
    14: [0,0], 20: [0,150], 18: [0,140], 19: [-85,170], 21: [-187,153],
    24: [0,0], 25: [0,-39], 588: [0,104], 26: [0,0], 27: [372,0],
    35: [220,0], 36: [0,212], 37: [270,242], 38: [50,148], 47: [0,116], 48: [346,0],
    395: [-103,0], 396: [-103,0], 397: [-103,0], 398: [-103,0], 399: [-103,228],
  };
  const dimensions = {
    190:[76,61],245:[90,66],298:[79,70],352:[132,109],199:[68,55],253:[40,62],306:[56,59],360:[81,83],
    194:[124,89],249:[149,96],302:[131,116],356:[125,166],197:[145,131],251:[74,98],304:[68,85],358:[123,131],
    200:[83,61],254:[87,54],307:[87,55],361:[94,93],
  };
  const background = resourceId => ({ layer: [resourceId, ...(positions[resourceId] || [0,0])] });
  const character = ([resourceId,x,y]) => ({ layer: [resourceId, Math.round(250+x-dimensions[resourceId][0]/2), Math.round(175-y-dimensions[resourceId][1]/2)] });
  const layers = route.back.map(background);
  layers.push(character(route.frog));
  if (companionId >= 0 && route.companions[companionId]) {
    layers.push(character(route.companions[companionId]));
  }
  layers.push(...route.front.map(background));
  return { id, pic_id: route.picId, layers, for_ads: false, visit: false };
}

module.exports = { TRAVEL_ROUTES, selectTrip, makePostcard };
