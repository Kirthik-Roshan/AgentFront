import type { Business, Category } from '../types'

export const categories: Category[] = ['Restaurants', 'Real Estate', 'Textiles', 'Manufacturing and Fabrication', 'Printing and Packaging']
export const locations = ['All Chennai', 'Ambattur', 'T. Nagar', 'Anna Nagar', 'Guindy', 'Perungudi', 'OMR']

export const businesses: Business[] = [
  { id: 'kumar', name: 'Kumar Engineering Works — Demo', category: 'Manufacturing and Fabrication', location: 'Ambattur Industrial Estate, Chennai', contact: '+91 90000 00004', rating: 4.4, reviews: 38, website: 'No website', opportunity: 'High', score: 100, marker: { x: 21, y: 37 } },
  { id: 'madras-metal', name: 'Madras Metalcraft Demo', category: 'Manufacturing and Fabrication', location: 'Guindy, Chennai', contact: '+91 90000 00009', rating: 4.2, reviews: 26, website: 'No website', opportunity: 'High', score: 88, marker: { x: 48, y: 67 } },
  { id: 'anbu-mess', name: 'Anbu Mess Demo Kitchen', category: 'Restaurants', location: 'T. Nagar, Chennai', contact: '+91 90000 00001', rating: 4.5, reviews: 112, website: 'Social profile only', opportunity: 'High', score: 92, marker: { x: 43, y: 47 } },
  { id: 'marina-table', name: 'Marina Table Demo Café', category: 'Restaurants', location: 'Anna Nagar, Chennai', contact: '+91 90000 00002', rating: 4.1, reviews: 64, website: 'No website', opportunity: 'Medium', score: 79, marker: { x: 36, y: 26 } },
  { id: 'nest-realty', name: 'Northstar Realty Demo', category: 'Real Estate', location: 'OMR, Chennai', contact: '+91 90000 00003', rating: 4.3, reviews: 44, website: 'Social profile only', opportunity: 'High', score: 85, marker: { x: 77, y: 59 } },
  { id: 'key-homes', name: 'Keyline Homes Demo', category: 'Real Estate', location: 'Perungudi, Chennai', contact: '+91 90000 00005', rating: 4.0, reviews: 21, website: 'No website', opportunity: 'Medium', score: 76, marker: { x: 68, y: 71 } },
  { id: 'saral-textiles', name: 'Saral Textiles Demo', category: 'Textiles', location: 'T. Nagar, Chennai', contact: '+91 90000 00006', rating: 4.6, reviews: 57, website: 'No website', opportunity: 'High', score: 89, marker: { x: 51, y: 43 } },
  { id: 'loomline', name: 'Loomline Demo Fabrics', category: 'Textiles', location: 'Anna Nagar, Chennai', contact: '+91 90000 00007', rating: 4.2, reviews: 33, website: 'Social profile only', opportunity: 'Medium', score: 75, marker: { x: 31, y: 19 } },
  { id: 'peacock-print', name: 'Peacock Printworks Demo', category: 'Printing and Packaging', location: 'Guindy, Chennai', contact: '+91 90000 00008', rating: 4.3, reviews: 29, website: 'No website', opportunity: 'High', score: 84, marker: { x: 57, y: 62 } },
  { id: 'boxcraft', name: 'Boxcraft Demo Packaging', category: 'Printing and Packaging', location: 'Ambattur, Chennai', contact: '+91 90000 00010', rating: 4.1, reviews: 18, website: 'No website', opportunity: 'Medium', score: 73, marker: { x: 18, y: 48 } }
]
