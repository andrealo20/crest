import { restoreStorage } from "./platform/kv";

// The settings and every saved store read localStorage as their modules load, so it is filled from Crest's own file first.
void restoreStorage().then(() => import("./app"));
