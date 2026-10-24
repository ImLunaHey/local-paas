export interface Storage {
  buckets: { id: string; name: string; status: string; storageId: string; storage: string }[]
  binding: { bucketId: string; status: string; readOnly: boolean } | null
}
