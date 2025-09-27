import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type Msg = { id: string; level: 'info'|'success'|'warning'|'error'; text: string; ts: number }

interface Ctx {
	messages: Msg[]
	push: (level: Msg['level'], text: string) => void
	clear: () => void
}

const MessagesContext = createContext<Ctx | null>(null)

export function MessagesProvider({ children }: { children: React.ReactNode }) {
	const [messages, setMessages] = useState<Msg[]>([])
	const push = useCallback<Ctx['push']>((level, text) => {
		setMessages(prev => [{ id: crypto.randomUUID(), level, text, ts: Date.now() }, ...prev].slice(0, 100))
	}, [])
	const clear = useCallback(() => setMessages([]), [])
	const value = useMemo(() => ({ messages, push, clear }), [messages, push, clear])
	return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>
}

export function useMessages() {
	const ctx = useContext(MessagesContext)
	if (!ctx) throw new Error('useMessages must be used within MessagesProvider')
	return ctx
}
