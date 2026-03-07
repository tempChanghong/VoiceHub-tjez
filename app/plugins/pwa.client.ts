export default defineNuxtPlugin(() => {
  if (import.meta.client && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(error => {
        console.error('Service worker registration failed:', error)
      })
    })
  }
})
