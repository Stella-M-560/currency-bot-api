addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  return new Response('Hello from your Worker!', {
    headers: { 'Content-Type': 'text/plain' }
  })
}
