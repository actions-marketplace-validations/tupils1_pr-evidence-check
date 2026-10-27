import { MARKER } from './render'

export function findSticky(comments: readonly { id: number; body?: string | null }[]): { id: number }[] {
  return comments
    .filter((comment) => (comment.body ?? '').includes(MARKER))
    .map((comment) => ({ id: comment.id }))
}
