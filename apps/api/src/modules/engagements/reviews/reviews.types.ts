import type {
  ReviewModelSlug,
  ReviewOutcome,
  ReviewPointStatus,
  ReviewType,
} from '@hsdg/contracts';

/** One matter raised during a review; blocks completion until resolved. */
export interface ReviewPointRecord {
  id: string;
  reviewId: string;
  raisedById: string;
  raisedByName: string | null;
  matter: string;
  isKeyMatter: boolean;
  status: ReviewPointStatus;
  resolvedById: string | null;
  resolvedByName: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/** One review event (manager review, EP review, or the terminal sign-off). */
export interface ReviewRecord {
  id: string;
  engagementId: string;
  reviewType: ReviewType;
  reviewerId: string;
  reviewerName: string | null;
  reviewerRole: string | null;
  outcome: ReviewOutcome;
  notes: string | null;
  supersededAt: string | null;
  supersededReason: string | null;
  createdAt: string;
  points: ReviewPointRecord[];
}

/** A review point raised as part of recording a review. */
export interface RaiseReviewPointInput {
  matter: string;
  isKeyMatter?: boolean;
}

export interface RecordReviewInput {
  /** Only manager/EP reviews are recorded here; sign-off has its own action. */
  reviewType: Extract<ReviewType, 'manager_review' | 'ep_review'>;
  outcome: Extract<ReviewOutcome, 'cleared' | 'returned'>;
  notes?: string;
  reviewPoints?: RaiseReviewPointInput[];
  version?: number;
}

export interface SignOffInput {
  notes?: string;
  version?: number;
}

export interface ResolveReviewPointInput {
  resolution: string;
}

export interface SetReviewPlanInput {
  reviewModelSlug: ReviewModelSlug;
  version?: number;
}
