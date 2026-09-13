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
  const layers = route.back.map(resourceId => ({ layer: [resourceId, 0, 0] }));
  layers.push({ layer: route.frog });
  if (companionId >= 0 && route.companions[companionId]) {
    layers.push({ layer: route.companions[companionId] });
  }
  layers.push(...route.front.map(resourceId => ({ layer: [resourceId, 0, 0] })));
  return { id, pic_id: route.picId, layers, for_ads: false, visit: false };
}

module.exports = { TRAVEL_ROUTES, selectTrip, makePostcard };
