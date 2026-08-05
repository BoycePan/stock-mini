import type {
  AnnouncementItem,
  AnnouncementListResponse,
  NewsItem,
  NewsListResponse,
  SectorMembersResponse,
} from '../types/stock'

export function unwrapNewsItems(response: NewsListResponse | NewsItem[]): NewsItem[] {
  return Array.isArray(response) ? response : response.news
}

export function unwrapAnnouncementItems(
  response: AnnouncementListResponse | AnnouncementItem[],
): AnnouncementItem[] {
  return Array.isArray(response) ? response : response.items
}

export function unwrapSectorMemberCodes(response: SectorMembersResponse | string[]): string[] {
  return Array.isArray(response) ? response : response.stocks
}
