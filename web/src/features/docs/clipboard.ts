export async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value)
    return
  }
  // Private HTTP development URLs don't expose the Clipboard API.
  const previous = document.activeElement
  const input = document.createElement('textarea')
  input.value = value
  input.className = 'fixed top-0 left-0 h-px w-px opacity-0'
  input.setAttribute('aria-label', 'Copy text')
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (previous instanceof HTMLElement) previous.focus()
  if (!copied) throw new Error('Select and copy the text manually.')
}
