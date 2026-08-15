import type { BuildStep } from '../types'

export const buildSteps: BuildStep[] = [
  { name: 'Research Agent', description: 'Analysing approved business information' },
  { name: 'Content Agent', description: 'Writing verified service descriptions' },
  { name: 'Design Agent', description: 'Applying industrial-blue visual system' },
  { name: 'Development Agent', description: 'Building drawing-upload interface' },
  { name: 'Testing Agent', description: 'Checking mobile layout and contact details' },
  { name: 'Deployment Agent', description: 'Preparing deployment preview for approval' }
]

export const qaChecks = ['Required pages present', 'Mobile layout passed', 'Contact details verified', 'Enquiry form tested', 'No missing images', 'Owner information approved', 'Accessibility checks passed']
