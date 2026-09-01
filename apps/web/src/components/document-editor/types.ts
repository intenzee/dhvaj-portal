/** Imperative handle every in-app editor exposes so the host can request its
 *  current contents as a Blob when the user saves a new version. */
export interface EditorHandle {
  export(): Promise<Blob>;
}
