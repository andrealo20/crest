// The pictures of Crest's wallpaper collection, as data: each one's id, its author and its photo's id on Unsplash, null for the
// pictures of unknown source.

export interface CollectionPicture {
  id: string;
  author: string | null;
  photo: string | null;
}

export const COLLECTION: readonly CollectionPicture[] = [];
