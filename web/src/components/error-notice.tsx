import { Button } from './button'

export function ErrorNotice({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="error-notice" role="alert">
      <strong>Something needs attention</strong>
      <p className="whitespace-pre-line">{error.message}</p>
      {retry && (
        <Button className="button secondary mt-3" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  )
}
