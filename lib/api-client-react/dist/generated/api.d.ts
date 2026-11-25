import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AiContent, AiContentUpdate, ApiToken, ApiTokenInput, Channel, DashboardStats, HealthStatus, JobStatus, ListJobsParams, ListPublishLogsParams, PublishLog, PublishOptions, Thumbnail, ThumbnailSelection, VideoJob, VideoJobInput } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * @summary Health check
 */
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListJobsUrl: (params?: ListJobsParams) => string;
/**
 * @summary List all video jobs
 */
export declare const listJobs: (params?: ListJobsParams, options?: RequestInit) => Promise<VideoJob[]>;
export declare const getListJobsQueryKey: (params?: ListJobsParams) => readonly ["/api/jobs", ...ListJobsParams[]];
export declare const getListJobsQueryOptions: <TData = Awaited<ReturnType<typeof listJobs>>, TError = ErrorType<unknown>>(params?: ListJobsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listJobs>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listJobs>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListJobsQueryResult = NonNullable<Awaited<ReturnType<typeof listJobs>>>;
export type ListJobsQueryError = ErrorType<unknown>;
/**
 * @summary List all video jobs
 */
export declare function useListJobs<TData = Awaited<ReturnType<typeof listJobs>>, TError = ErrorType<unknown>>(params?: ListJobsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listJobs>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateJobUrl: () => string;
/**
 * @summary Create a new video job
 */
export declare const createJob: (videoJobInput: VideoJobInput, options?: RequestInit) => Promise<VideoJob>;
export declare const getCreateJobMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createJob>>, TError, {
        data: BodyType<VideoJobInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createJob>>, TError, {
    data: BodyType<VideoJobInput>;
}, TContext>;
export type CreateJobMutationResult = NonNullable<Awaited<ReturnType<typeof createJob>>>;
export type CreateJobMutationBody = BodyType<VideoJobInput>;
export type CreateJobMutationError = ErrorType<unknown>;
/**
* @summary Create a new video job
*/
export declare const useCreateJob: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createJob>>, TError, {
        data: BodyType<VideoJobInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createJob>>, TError, {
    data: BodyType<VideoJobInput>;
}, TContext>;
export declare const getGetJobUrl: (id: number) => string;
/**
 * @summary Get a job by ID
 */
export declare const getJob: (id: number, options?: RequestInit) => Promise<VideoJob>;
export declare const getGetJobQueryKey: (id: number) => readonly [`/api/jobs/${number}`];
export declare const getGetJobQueryOptions: <TData = Awaited<ReturnType<typeof getJob>>, TError = ErrorType<void>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getJob>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getJob>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetJobQueryResult = NonNullable<Awaited<ReturnType<typeof getJob>>>;
export type GetJobQueryError = ErrorType<void>;
/**
 * @summary Get a job by ID
 */
export declare function useGetJob<TData = Awaited<ReturnType<typeof getJob>>, TError = ErrorType<void>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getJob>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getDeleteJobUrl: (id: number) => string;
/**
 * @summary Delete a job
 */
export declare const deleteJob: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteJobMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteJob>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteJob>>, TError, {
    id: number;
}, TContext>;
export type DeleteJobMutationResult = NonNullable<Awaited<ReturnType<typeof deleteJob>>>;
export type DeleteJobMutationError = ErrorType<unknown>;
/**
* @summary Delete a job
*/
export declare const useDeleteJob: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteJob>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteJob>>, TError, {
    id: number;
}, TContext>;
export declare const getGetJobStatusUrl: (id: number) => string;
/**
 * @summary Get job processing status and progress
 */
export declare const getJobStatus: (id: number, options?: RequestInit) => Promise<JobStatus>;
export declare const getGetJobStatusQueryKey: (id: number) => readonly [`/api/jobs/${number}/status`];
export declare const getGetJobStatusQueryOptions: <TData = Awaited<ReturnType<typeof getJobStatus>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getJobStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getJobStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetJobStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getJobStatus>>>;
export type GetJobStatusQueryError = ErrorType<unknown>;
/**
 * @summary Get job processing status and progress
 */
export declare function useGetJobStatus<TData = Awaited<ReturnType<typeof getJobStatus>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getJobStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getProcessJobUrl: (id: number) => string;
/**
 * @summary Start processing a job (download + AI generation)
 */
export declare const processJob: (id: number, options?: RequestInit) => Promise<VideoJob>;
export declare const getProcessJobMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof processJob>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof processJob>>, TError, {
    id: number;
}, TContext>;
export type ProcessJobMutationResult = NonNullable<Awaited<ReturnType<typeof processJob>>>;
export type ProcessJobMutationError = ErrorType<unknown>;
/**
* @summary Start processing a job (download + AI generation)
*/
export declare const useProcessJob: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof processJob>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof processJob>>, TError, {
    id: number;
}, TContext>;
export declare const getPublishJobUrl: (id: number) => string;
/**
 * @summary Publish job to selected platforms
 */
export declare const publishJob: (id: number, publishOptions: PublishOptions, options?: RequestInit) => Promise<VideoJob>;
export declare const getPublishJobMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof publishJob>>, TError, {
        id: number;
        data: BodyType<PublishOptions>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof publishJob>>, TError, {
    id: number;
    data: BodyType<PublishOptions>;
}, TContext>;
export type PublishJobMutationResult = NonNullable<Awaited<ReturnType<typeof publishJob>>>;
export type PublishJobMutationBody = BodyType<PublishOptions>;
export type PublishJobMutationError = ErrorType<unknown>;
/**
* @summary Publish job to selected platforms
*/
export declare const usePublishJob: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof publishJob>>, TError, {
        id: number;
        data: BodyType<PublishOptions>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof publishJob>>, TError, {
    id: number;
    data: BodyType<PublishOptions>;
}, TContext>;
export declare const getApproveJobUrl: (id: number) => string;
/**
 * @summary Approve job for publishing
 */
export declare const approveJob: (id: number, options?: RequestInit) => Promise<VideoJob>;
export declare const getApproveJobMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof approveJob>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof approveJob>>, TError, {
    id: number;
}, TContext>;
export type ApproveJobMutationResult = NonNullable<Awaited<ReturnType<typeof approveJob>>>;
export type ApproveJobMutationError = ErrorType<unknown>;
/**
* @summary Approve job for publishing
*/
export declare const useApproveJob: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof approveJob>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof approveJob>>, TError, {
    id: number;
}, TContext>;
export declare const getGetJobContentUrl: (id: number) => string;
/**
 * @summary Get AI generated content for a job
 */
export declare const getJobContent: (id: number, options?: RequestInit) => Promise<AiContent>;
export declare const getGetJobContentQueryKey: (id: number) => readonly [`/api/jobs/${number}/content`];
export declare const getGetJobContentQueryOptions: <TData = Awaited<ReturnType<typeof getJobContent>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getJobContent>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getJobContent>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetJobContentQueryResult = NonNullable<Awaited<ReturnType<typeof getJobContent>>>;
export type GetJobContentQueryError = ErrorType<unknown>;
/**
 * @summary Get AI generated content for a job
 */
export declare function useGetJobContent<TData = Awaited<ReturnType<typeof getJobContent>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getJobContent>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateJobContentUrl: (id: number) => string;
/**
 * @summary Update AI generated content
 */
export declare const updateJobContent: (id: number, aiContentUpdate: AiContentUpdate, options?: RequestInit) => Promise<AiContent>;
export declare const getUpdateJobContentMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateJobContent>>, TError, {
        id: number;
        data: BodyType<AiContentUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateJobContent>>, TError, {
    id: number;
    data: BodyType<AiContentUpdate>;
}, TContext>;
export type UpdateJobContentMutationResult = NonNullable<Awaited<ReturnType<typeof updateJobContent>>>;
export type UpdateJobContentMutationBody = BodyType<AiContentUpdate>;
export type UpdateJobContentMutationError = ErrorType<unknown>;
/**
* @summary Update AI generated content
*/
export declare const useUpdateJobContent: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateJobContent>>, TError, {
        id: number;
        data: BodyType<AiContentUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateJobContent>>, TError, {
    id: number;
    data: BodyType<AiContentUpdate>;
}, TContext>;
export declare const getRegenerateContentUrl: (id: number) => string;
/**
 * @summary Regenerate AI content using Gemini
 */
export declare const regenerateContent: (id: number, options?: RequestInit) => Promise<AiContent>;
export declare const getRegenerateContentMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof regenerateContent>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof regenerateContent>>, TError, {
    id: number;
}, TContext>;
export type RegenerateContentMutationResult = NonNullable<Awaited<ReturnType<typeof regenerateContent>>>;
export type RegenerateContentMutationError = ErrorType<unknown>;
/**
* @summary Regenerate AI content using Gemini
*/
export declare const useRegenerateContent: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof regenerateContent>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof regenerateContent>>, TError, {
    id: number;
}, TContext>;
export declare const getGetJobThumbnailsUrl: (id: number) => string;
/**
 * @summary Get thumbnail variants for a job
 */
export declare const getJobThumbnails: (id: number, options?: RequestInit) => Promise<Thumbnail[]>;
export declare const getGetJobThumbnailsQueryKey: (id: number) => readonly [`/api/jobs/${number}/thumbnails`];
export declare const getGetJobThumbnailsQueryOptions: <TData = Awaited<ReturnType<typeof getJobThumbnails>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getJobThumbnails>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getJobThumbnails>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetJobThumbnailsQueryResult = NonNullable<Awaited<ReturnType<typeof getJobThumbnails>>>;
export type GetJobThumbnailsQueryError = ErrorType<unknown>;
/**
 * @summary Get thumbnail variants for a job
 */
export declare function useGetJobThumbnails<TData = Awaited<ReturnType<typeof getJobThumbnails>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getJobThumbnails>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getSelectThumbnailUrl: (id: number) => string;
/**
 * @summary Select a thumbnail for publishing
 */
export declare const selectThumbnail: (id: number, thumbnailSelection: ThumbnailSelection, options?: RequestInit) => Promise<VideoJob>;
export declare const getSelectThumbnailMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof selectThumbnail>>, TError, {
        id: number;
        data: BodyType<ThumbnailSelection>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof selectThumbnail>>, TError, {
    id: number;
    data: BodyType<ThumbnailSelection>;
}, TContext>;
export type SelectThumbnailMutationResult = NonNullable<Awaited<ReturnType<typeof selectThumbnail>>>;
export type SelectThumbnailMutationBody = BodyType<ThumbnailSelection>;
export type SelectThumbnailMutationError = ErrorType<unknown>;
/**
* @summary Select a thumbnail for publishing
*/
export declare const useSelectThumbnail: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof selectThumbnail>>, TError, {
        id: number;
        data: BodyType<ThumbnailSelection>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof selectThumbnail>>, TError, {
    id: number;
    data: BodyType<ThumbnailSelection>;
}, TContext>;
export declare const getListTokensUrl: () => string;
/**
 * @summary List all connected platform tokens
 */
export declare const listTokens: (options?: RequestInit) => Promise<ApiToken[]>;
export declare const getListTokensQueryKey: () => readonly ["/api/tokens"];
export declare const getListTokensQueryOptions: <TData = Awaited<ReturnType<typeof listTokens>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTokens>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listTokens>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListTokensQueryResult = NonNullable<Awaited<ReturnType<typeof listTokens>>>;
export type ListTokensQueryError = ErrorType<unknown>;
/**
 * @summary List all connected platform tokens
 */
export declare function useListTokens<TData = Awaited<ReturnType<typeof listTokens>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTokens>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateTokenUrl: () => string;
/**
 * @summary Add a platform API token
 */
export declare const createToken: (apiTokenInput: ApiTokenInput, options?: RequestInit) => Promise<ApiToken>;
export declare const getCreateTokenMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createToken>>, TError, {
        data: BodyType<ApiTokenInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createToken>>, TError, {
    data: BodyType<ApiTokenInput>;
}, TContext>;
export type CreateTokenMutationResult = NonNullable<Awaited<ReturnType<typeof createToken>>>;
export type CreateTokenMutationBody = BodyType<ApiTokenInput>;
export type CreateTokenMutationError = ErrorType<unknown>;
/**
* @summary Add a platform API token
*/
export declare const useCreateToken: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createToken>>, TError, {
        data: BodyType<ApiTokenInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createToken>>, TError, {
    data: BodyType<ApiTokenInput>;
}, TContext>;
export declare const getDeleteTokenUrl: (id: number) => string;
/**
 * @summary Remove a platform token
 */
export declare const deleteToken: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteTokenMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteToken>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteToken>>, TError, {
    id: number;
}, TContext>;
export type DeleteTokenMutationResult = NonNullable<Awaited<ReturnType<typeof deleteToken>>>;
export type DeleteTokenMutationError = ErrorType<unknown>;
/**
* @summary Remove a platform token
*/
export declare const useDeleteToken: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteToken>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteToken>>, TError, {
    id: number;
}, TContext>;
export declare const getListChannelsUrl: () => string;
/**
 * @summary List all connected channels
 */
export declare const listChannels: (options?: RequestInit) => Promise<Channel[]>;
export declare const getListChannelsQueryKey: () => readonly ["/api/channels"];
export declare const getListChannelsQueryOptions: <TData = Awaited<ReturnType<typeof listChannels>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listChannels>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listChannels>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListChannelsQueryResult = NonNullable<Awaited<ReturnType<typeof listChannels>>>;
export type ListChannelsQueryError = ErrorType<unknown>;
/**
 * @summary List all connected channels
 */
export declare function useListChannels<TData = Awaited<ReturnType<typeof listChannels>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listChannels>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetStatsUrl: () => string;
/**
 * @summary Get dashboard stats
 */
export declare const getStats: (options?: RequestInit) => Promise<DashboardStats>;
export declare const getGetStatsQueryKey: () => readonly ["/api/stats"];
export declare const getGetStatsQueryOptions: <TData = Awaited<ReturnType<typeof getStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getStats>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStatsQueryResult = NonNullable<Awaited<ReturnType<typeof getStats>>>;
export type GetStatsQueryError = ErrorType<unknown>;
/**
 * @summary Get dashboard stats
 */
export declare function useGetStats<TData = Awaited<ReturnType<typeof getStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListPublishLogsUrl: (params?: ListPublishLogsParams) => string;
/**
 * @summary List recent publish logs
 */
export declare const listPublishLogs: (params?: ListPublishLogsParams, options?: RequestInit) => Promise<PublishLog[]>;
export declare const getListPublishLogsQueryKey: (params?: ListPublishLogsParams) => readonly ["/api/publish-logs", ...ListPublishLogsParams[]];
export declare const getListPublishLogsQueryOptions: <TData = Awaited<ReturnType<typeof listPublishLogs>>, TError = ErrorType<unknown>>(params?: ListPublishLogsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPublishLogs>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listPublishLogs>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListPublishLogsQueryResult = NonNullable<Awaited<ReturnType<typeof listPublishLogs>>>;
export type ListPublishLogsQueryError = ErrorType<unknown>;
/**
 * @summary List recent publish logs
 */
export declare function useListPublishLogs<TData = Awaited<ReturnType<typeof listPublishLogs>>, TError = ErrorType<unknown>>(params?: ListPublishLogsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPublishLogs>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export {};
//# sourceMappingURL=api.d.ts.map