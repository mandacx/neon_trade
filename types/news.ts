/** News item as sent to the browser (plain text only; the publisher's HTML never leaves the server). */
export interface NewsItem {
  id: number;
  headline: string;
  /** One-sentence teaser from the publisher; may be empty. */
  summary: string;
  /** Plain-text excerpt of the body (about 150-250 words), or null when excerpts are off / the article has no body. */
  excerpt: string | null;
  /** True when the body continues past the excerpt (show "Read more" either way when `url` is set). */
  truncated: boolean;
  /** Link to the article at its publisher. */
  url: string | null;
  /** Publisher name, shown as attribution. */
  source: string;
  /** ISO instant. */
  createdAt: string;
  symbols: string[];
  /** Small thumbnail, or null. */
  imageUrl: string | null;
}

export interface NewsResponse {
  items: NewsItem[];
  /** ISO instant the server fetched this list from the feed (not when the browser asked). */
  fetchedAt: string;
}
