import { buildMuseBody } from './museBody';

// Muse's body is meshed off the main thread (about 0.3 s of field
// sampling), so no frame waits on it; muse.ts takes the arrays as they are.
const body = buildMuseBody();
postMessage(body, {
  transfer: [body.position.buffer, body.normal.buffer, body.index.buffer, body.skinIndex.buffer, body.skinWeight.buffer, body.fur.buffer, body.open.buffer],
});
