import type { ConversationMessage } from '../types'

export const outreachMessages: ConversationMessage[] = [
  { sender: 'AgentFront Sales Agent', role: 'agent', body: 'Hello Mr. Kumar. I’m an AI assistant from AgentFront. With your permission, I’d like to discuss a private website concept for your business. No information will be published without approval.', time: '10:02' },
  { sender: 'AgentFront Sales Agent', role: 'agent', body: 'We can prepare a private concept first, so you can review the idea before deciding anything.', time: '10:02' },
  { sender: 'Kumar, Business Owner', role: 'owner', body: 'Okay, you can explain. Please keep it private for now.', time: '10:03' },
  { sender: 'AgentFront Sales Agent', role: 'agent', body: 'Thank you. Could you tell me the main work your workshop handles?', time: '10:03' },
  { sender: 'Kumar, Business Owner', role: 'owner', body: 'We provide laser cutting, bending and welding work for industrial customers.', time: '10:04' },
  { sender: 'AgentFront Sales Agent', role: 'agent', body: 'Understood. Do customers mainly call or use WhatsApp today?', time: '10:04' },
  { sender: 'Kumar, Business Owner', role: 'owner', body: 'Yes, mostly calls and WhatsApp. They send drawings there.', time: '10:05' },
  { sender: 'AgentFront Sales Agent', role: 'agent', body: 'A website could clearly present services, accept enquiries and let customers attach drawings. Would that be useful?', time: '10:05' },
  { sender: 'Kumar, Business Owner', role: 'owner', body: 'Yes, that sounds useful. Let’s collect the requirements.', time: '10:06' }
]

export const requirementMessages: ConversationMessage[] = [
  { sender: 'AgentFront Requirements Agent', role: 'agent', body: 'Which exact services and material capacities should we publish?', time: '10:08' },
  { sender: 'Kumar, Business Owner', role: 'owner', body: 'Laser cutting, metal bending, MIG and TIG welding. Mild steel up to 12 mm and stainless steel up to 6 mm.', time: '10:09' },
  { sender: 'Kumar, Business Owner', role: 'owner', body: 'Customer drawing is required. We serve Chennai. Website should be in Tamil and English.', time: '10:10' },
  { sender: 'AgentFront Requirements Agent', role: 'agent', body: 'I’ve noted an industrial-blue style, pages for Home, Services, Capabilities, About and Contact, plus drawing upload and WhatsApp enquiry.', time: '10:11' },
  { sender: 'Kumar, Business Owner', role: 'owner', body: 'Correct. Seven days is fine for completion.', time: '10:11' }
]

export const requirementFields = [
  ['Services', 'Laser cutting · Metal bending · MIG & TIG welding', 2],
  ['Material capability', 'MS 12 mm · SS 6 mm', 2],
  ['Customer input', 'Drawing required', 3],
  ['Service area', 'Chennai', 3],
  ['Language', 'Tamil & English', 3],
  ['Visual direction', 'Industrial blue', 4],
  ['Pages', 'Home · Services · Capabilities · About · Contact', 4],
  ['Lead capture', 'Drawing upload · WhatsApp enquiry', 4],
  ['Target completion', 'Seven days', 5]
] as const
