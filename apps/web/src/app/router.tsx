import { createBrowserRouter } from 'react-router-dom'
import { ChatPage } from '../features/chat/chat-page'
import { CallbackPage } from '../features/auth/callback-page'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <ChatPage />
  },
  {
    path: '/auth/callback',
    element: <CallbackPage />
  }
])
