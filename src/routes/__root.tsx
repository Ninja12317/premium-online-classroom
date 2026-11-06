import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NotFoundPage } from '@/components/error-pages'
import { IdentityProvider } from '@/components/identity-provider'
import { AuthCallbackHandler } from '@/components/auth-callback'

import '../styles.css'

const siteName = 'Lectern — live online classroom'
const siteDescription =
  'Lectern is a live video classroom for teachers: start a class in one click, students join from a link, teach with video, screen share, whiteboard and chat.'

// Applies the saved theme before first paint so the page never flashes.
const themeScript = `(function(){try{var t=localStorage.getItem('lectern-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d){document.documentElement.classList.add('dark')}}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: siteName },
      { name: 'description', content: siteDescription },
      { property: 'og:title', content: siteName },
      { property: 'og:description', content: siteDescription },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'theme-color', content: '#f8f7f3' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Instrument+Sans:ital,wght@0,400..700;1,400..700&display=swap',
      },
    ],
    scripts: [{ children: themeScript }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: NotFoundPage,
})

// Handles emailed sign-in links (confirmation, password reset) on every page.
function RootLayout() {
  return (
    <>
      <AuthCallbackHandler />
      <Outlet />
    </>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <IdentityProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </IdentityProvider>
        <Toaster position="top-center" />
        <Scripts />
      </body>
    </html>
  )
}
