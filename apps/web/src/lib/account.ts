// Account-domain contract shared with the NestJS API: see @archlast/contracts
// (packages/contracts) for the types and the Nest v1 REST surface. The browser
// never talks to Nest directly: Next route handlers under /api/account/* forward
// to it and own the httpOnly `mb_token` cookie.

export {
  MEDIA_TYPES,
  PROVIDER_IDS,
  REGION_IDS,
  DEFAULT_SUB_STYLE,
  isMediaType,
  isProviderId,
  isRegionId,
} from "@archlast/contracts";
export type {
  AccountSettings,
  AccountState,
  AccountUser,
  MediaType,
  MyListItem,
  PlayerPrefsSubset,
  ProviderId as AccountProviderId,
  RegionId,
  SubStyle,
  WatchEntry,
} from "@archlast/contracts";
