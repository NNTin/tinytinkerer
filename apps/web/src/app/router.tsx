import { createBrowserRouter } from 'react-router-dom'
import { ChatPage } from '../features/chat/chat-page'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <ChatPage />
  }
])
