// The pictures of Crest's wallpaper collection, as data: each one's id, its author and its photo's id on Unsplash, null for the
// pictures of unknown source, and the full-size file's bytes (scripts/wallpapers.py writes them in manifest.json). In file name
// order, the order Next and the automatic change follow. Credits: src/assets/wallpapers/CREDITS.md.

export interface CollectionPicture {
  id: string;
  author: string | null;
  photo: string | null;
  bytes: number;
}

export const COLLECTION: readonly CollectionPicture[] = [
  { id: "629958", author: null, photo: null, bytes: 1009593 },
  { id: "809524", author: null, photo: null, bytes: 385247 },
  { id: "884853", author: null, photo: null, bytes: 265620 },
  { id: "885155", author: null, photo: null, bytes: 347207 },
  { id: "99789", author: null, photo: null, bytes: 259947 },
  { id: "99790", author: null, photo: null, bytes: 208499 },
  { id: "a-chosen-soul-3-LRLm5cm0c", author: "A Chosen Soul", photo: "3-LRLm5cm0c", bytes: 551343 },
  { id: "alexander-lunyov-Qx6dv2tcceU", author: "Alexander Lunyov", photo: "Qx6dv2tcceU", bytes: 1649715 },
  { id: "andrei-castanha-qTZr2TEUNBo", author: "Andrei Castanha", photo: "qTZr2TEUNBo", bytes: 1780958 },
  { id: "birmingham-museums-trust-yRDu4_w4g4A", author: "Birmingham Museums Trust", photo: "yRDu4_w4g4A", bytes: 1984916 },
  { id: "dim-gunger-Am9Se-CMNvM", author: "Dim Gunger", photo: "Am9Se-CMNvM", bytes: 2362162 },
  { id: "dynamic-wang-irn9H9-Kfq4", author: "Dynamic Wang", photo: "irn9H9-Kfq4", bytes: 1275296 },
  { id: "johny-goerend-Oz2ZQ2j8We8", author: "Johny Goerend", photo: "Oz2ZQ2j8We8", bytes: 825115 },
  { id: "jonas-denil-yVMFWzg7ObU", author: "Jonas Denil", photo: "yVMFWzg7ObU", bytes: 1983193 },
  { id: "kerensa-pickett-GjpUV4k76F8", author: "Kerensa Pickett", photo: "GjpUV4k76F8", bytes: 1271557 },
  { id: "milad-fakurian-rfZnGUin6WY", author: "Milad Fakurian", photo: "rfZnGUin6WY", bytes: 273043 },
  { id: "pawel-czerwinski-PvgqqicSLvA", author: "Pawel Czerwinski", photo: "PvgqqicSLvA", bytes: 2241866 },
  { id: "pawel-czerwinski-YAtspJ-HV2E", author: "Pawel Czerwinski", photo: "YAtspJ-HV2E", bytes: 517822 },
  { id: "pawel-czerwinski-rlJG8NIjfZs", author: "Pawel Czerwinski", photo: "rlJG8NIjfZs", bytes: 1555580 },
  { id: "peter-olexa-RYtiT3b7XW4", author: "Peter Olexa", photo: "RYtiT3b7XW4", bytes: 983430 },
  { id: "richard-horvath-_nWaeTF6qo0", author: "Richard Horvath", photo: "_nWaeTF6qo0", bytes: 215178 },
  { id: "shubham-dhage-qQU2hOFtygg", author: "Shubham Dhage", photo: "qQU2hOFtygg", bytes: 2108947 },
  { id: "simon-lee-egWTpKFu8rU", author: "SIMON LEE", photo: "egWTpKFu8rU", bytes: 1030307 },
  { id: "steven-lynn-Fh_gYZPIYZE", author: "Steven Lynn", photo: "Fh_gYZPIYZE", bytes: 1994818 },
];

/** The full-size files' bytes of these pictures; an id not in the collection counts nothing. */
export const bytesOf = (ids: Iterable<string>): number => [...ids].reduce((sum, id) => sum + (COLLECTION.find((p) => p.id === id)?.bytes ?? 0), 0);
