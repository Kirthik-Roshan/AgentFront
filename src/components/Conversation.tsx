import { Bot, CheckCheck, CircleUserRound, Pause, Play, Shield, SkipForward } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ConversationMessage } from '../types'
import { Button } from './ui'

export function Conversation({ messages, visible, onNext, onComplete, completeLabel = 'Continue', title = 'Owner conversation', subtitle = 'Simulated private channel' }: { messages: ConversationMessage[]; visible: number; onNext: () => void; onComplete?: () => void; completeLabel?: string; title?: string; subtitle?: string }) {
  const done = visible >= messages.length
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing || done) return
    const timer = window.setTimeout(onNext, 750)
    return () => window.clearTimeout(timer)
  }, [playing, done, visible, onNext])
  return <section className="chat-shell">
    <div className="chat-head"><div className="chat-avatar"><span>KE</span><i/></div><div><strong>{title}</strong><span>{subtitle} · Fictional participants</span></div><span className="secure-chat"><Shield size={14}/>Consent tracked</span></div>
    <div className="chat-messages" aria-live="polite">
      {messages.slice(0, visible).map((message, index) => <div key={`${message.time}-${index}`} className={`chat-row chat-${message.role}`}>
        <div className="sender-icon">{message.role === 'agent' ? <Bot size={17}/> : message.role === 'supervisor' ? <Shield size={17}/> : <CircleUserRound size={17}/>}</div>
        <div className="message-wrap"><span className="sender-name">{message.sender}</span><div className="message-bubble"><p>{message.body}</p><small>{message.time}<CheckCheck size={13}/></small></div></div>
      </div>)}
      {!done && <div className="typing-row"><div className="sender-icon"><Bot size={17}/></div><div className="typing"><i/><i/><i/></div><span>Agent is ready</span></div>}
    </div>
    <div className="chat-controls"><span>{visible} of {messages.length} messages</span><div>{!done && <Button variant="ghost" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15}/> : <Play size={15}/>} {playing ? 'Pause conversation' : 'Play conversation'}</Button>}{!done && <Button variant="secondary" onClick={onNext}><Play size={15}/>Next message</Button>}{done && onComplete && <Button onClick={onComplete}>{completeLabel}<SkipForward size={15}/></Button>}</div></div>
  </section>
}
