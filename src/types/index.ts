export type Category = 'Restaurants' | 'Real Estate' | 'Textiles' | 'Manufacturing and Fabrication' | 'Printing and Packaging'

export interface Business {
  id: string
  name: string
  category: Category
  location: string
  contact: string
  rating: number
  reviews: number
  website: 'No website' | 'Social profile only'
  opportunity: 'High' | 'Medium'
  score: number
  marker: { x: number; y: number }
}

export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type MessageRole = 'agent' | 'owner' | 'supervisor'

export interface ConversationMessage {
  sender: string
  role: MessageRole
  body: string
  time: string
}

export interface BuildStep {
  name: string
  description: string
}

export type RequirementStatus = 'Owner verified' | 'Needs confirmation' | 'Missing'
