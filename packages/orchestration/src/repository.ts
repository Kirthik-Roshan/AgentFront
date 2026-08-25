import type { CampaignStatus, LeadAggregate } from "@agentfront/types";

export interface WorkflowRepository {
  nextProjectId(): Promise<string>;
  findByLeadId(leadId: string): Promise<LeadAggregate | null>;
  findByProjectId(projectId: string): Promise<LeadAggregate | null>;
  findByBusinessAndCampaign(businessId: string, campaignId: string): Promise<LeadAggregate | null>;
  getCampaignStatus?(campaignId: string): Promise<CampaignStatus | null>;
  save(aggregate: LeadAggregate): Promise<void>;
  list(): Promise<LeadAggregate[]>;
}
