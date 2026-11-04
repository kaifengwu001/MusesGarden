// Every kind of job and the pipeline that runs it.
import { bodyPipeline } from './body';
import { homePipeline } from './home';
import { planetPipeline } from './planet';
import type { JobKind, Pipeline } from './types';

export const PIPELINES: Readonly<Record<JobKind, Pipeline>> = { body: bodyPipeline, planet: planetPipeline, home: homePipeline };
