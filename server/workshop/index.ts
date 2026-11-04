// The workshop, for the server to mount: createWorkshop (the Workshop API over its runner and store), the file
// routes (/w/<job>/<file>, /api/looks/<id>.*), and the clients (live Meta, or fakes under WORKSHOP_FAKE=1).
export { checkBrief, checkVerdict, createWorkshop, MAX_DRAFTS, MAX_VIEWS } from './api';
export type { WorkshopDeps, WorkshopRuntime } from './api';
export { clientsFromEnv, liveClients } from './live';
export type { LiveOptions } from './live';
export { workshopFiles } from './routes';
export type { FileHandler } from './routes';
export { isJobId, jobDir, looksDir, newJobId, openJobStore } from './store';
export type { JobStore, StoredJob } from './store';
export type * from './types';
