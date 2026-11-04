import type { BusinessType } from "./domain";

export const BUSINESS_VERTICALS = [
  { id: "restaurant", label: "Restaurant", searchQuery: "restaurants", template: "restaurant" },
  { id: "gym-fitness-centre", label: "Gym / fitness centre", searchQuery: "gyms and fitness centres", template: "fitness" },
  { id: "spa-beauty-parlour", label: "Spa / beauty parlour", searchQuery: "spas and beauty parlours", template: "spa" },
  { id: "dental-clinic", label: "Dental clinic", searchQuery: "dental clinics", template: "dental" },
  { id: "physiotherapy-clinic", label: "Physiotherapy clinic", searchQuery: "physiotherapy clinics", template: "physiotherapy" },
  { id: "tuition-coaching-centre", label: "Tuition / coaching centre", searchQuery: "tuition and coaching centres", template: "education" },
  { id: "pet-grooming-vet-clinic", label: "Pet grooming / vet clinic", searchQuery: "pet grooming and veterinary clinics", template: "petcare" },
  { id: "bakery-cafe", label: "Bakery / cafe", searchQuery: "bakeries and cafes", template: "bakery" },
  { id: "catering-service", label: "Catering service", searchQuery: "catering services", template: "catering" },
  { id: "event-wedding-planner", label: "Event / wedding planner", searchQuery: "event and wedding planners", template: "events" },
  { id: "photography-studio", label: "Photography studio", searchQuery: "photography studios", template: "photography" },
  { id: "interior-designer", label: "Interior designer", searchQuery: "interior designers", template: "interiors" },
  { id: "real-estate-broker", label: "Real-estate broker", searchQuery: "real estate brokers", template: "realestate" },
  { id: "travel-agency", label: "Travel agency", searchQuery: "travel agencies", template: "travel" },
  { id: "packers-movers", label: "Packers & movers", searchQuery: "packers and movers", template: "movers" },
  { id: "ac-appliance-repair", label: "AC / appliance repair", searchQuery: "AC and appliance repair services", template: "appliance" },
  { id: "electrician-plumber", label: "Electrician / plumber", searchQuery: "electricians and plumbers", template: "trades" },
  { id: "car-wash-detailing", label: "Car wash / detailing", searchQuery: "car wash and detailing services", template: "detailing" },
  { id: "driving-school", label: "Driving school", searchQuery: "driving schools", template: "drivingschool" },
  { id: "laundry-dry-cleaning", label: "Laundry / dry cleaning", searchQuery: "laundry and dry cleaning services", template: "laundry" },
  { id: "furniture-home-decor", label: "Furniture / home decor shop", searchQuery: "furniture and home decor shops", template: "furniture" },
  { id: "mobile-laptop-repair", label: "Mobile / laptop repair", searchQuery: "mobile and laptop repair shops", template: "devicerepair" },
  { id: "printing-signage", label: "Printing / signage shop", searchQuery: "printing and signage shops", template: "printing" },
  { id: "florist-gift-shop", label: "Florist / gift shop", searchQuery: "florists and gift shops", template: "florist" },
  { id: "jewellery-shop", label: "Jewellery shop", searchQuery: "jewellery shops", template: "jewellery" },
  { id: "boutique-tailoring", label: "Boutique / tailoring", searchQuery: "boutiques and tailoring shops", template: "tailoring" },
  { id: "home-bakery-cloud-kitchen", label: "Home bakery / cloud kitchen", searchQuery: "home bakeries and cloud kitchens", template: "cloudkitchen" },
  { id: "clinic", label: "Clinic", searchQuery: "clinics and medical centres", template: "clinic" },
  { id: "education", label: "Education / academy", searchQuery: "coaching centres and academies", template: "education" },
  { id: "realestate", label: "Real estate", searchQuery: "real estate agencies", template: "realestate" },
  { id: "fitness", label: "Gym / fitness studio", searchQuery: "gyms and fitness studios", template: "fitness" },
  { id: "bakery", label: "Bakery / cake shop", searchQuery: "bakeries and cake shops", template: "bakery" },
  { id: "legal", label: "Legal services", searchQuery: "law firms and legal services", template: "legal" },
  { id: "salon", label: "Salon", searchQuery: "beauty salons", template: "salon" },
  { id: "garments", label: "Garments", searchQuery: "garment and clothing shops", template: "garments" },
  { id: "mechanic", label: "Mechanic workshop", searchQuery: "automobile mechanic workshops", template: "mechanic" },
] as const satisfies readonly {
  id: string;
  label: string;
  searchQuery: string;
  template: BusinessType;
}[];

export type BusinessVerticalId = (typeof BUSINESS_VERTICALS)[number]["id"];

const byId = new Map<string, (typeof BUSINESS_VERTICALS)[number]>(
  BUSINESS_VERTICALS.map((vertical) => [vertical.id, vertical]),
);

export function resolveBusinessVertical(id: string | null | undefined) {
  return byId.get(id?.trim().toLowerCase() ?? "") ?? null;
}
