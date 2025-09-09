// Rentman API Types based on PDF documentation

export interface RentmanProperty {
  // Core identifiers
  propref: string;
  displayaddress: string;
  displayprice: string;
  rentmonth: string;
  rentorbuy: '1' | '2' | '3'; // 1=Rent, 2=Sale, 3=Both
  
  // Address details
  number: string;
  street: string;
  address1: string;
  address2: string;
  address3: string;
  address4: string;
  postcode: string;
  area: string;
  geolocation: string; // "lat,lng" format
  
  // Property details
  type: string;
  beds: string;
  singles: string;
  doubles: string;
  baths: string;
  receps: string;
  furnished: '1' | '2' | '3' | '4'; // 1=Furnished, 2=Unfurnished, 3=Part, 4=Flexible
  
  // Description
  description: string;
  comments: string;
  strapline: string;
  bullets: string;
  
  // Features
  heating: string;
  floor: string;
  age: string;
  rating: string;
  council: string;
  counciltax: string;
  
  // Availability
  available: string; // Date format
  status: string;
  shortlet: string;
  
  // Financial
  deposit: string;
  fees: string;
  
  // Media (base64 encoded)
  photo1?: string;
  photo2?: string;
  photo3?: string;
  photo4?: string;
  photo5?: string;
  photo6?: string;
  photo7?: string;
  photo8?: string;
  photo9?: string;
  floorplan?: string;
  epc?: string;
  brochure?: string;
  
  // Contact
  negotiator: string;
  branch: string;
  telephone: string;
  mobile: string;
  email: string;
  
  // Meta
  featured: '1' | '0';
  lastchanged: string;
  dateadded: string;
}

export interface RentmanApiResponse {
  properties: RentmanProperty[];
  totalcount: number;
  page: number;
  limit: number;
}

export interface RentmanMediaResponse {
  filename: string;
  base64data: string;
  contenttype: string;
  size: number;
}

export interface RentmanApiParams {
  // Core parameters
  rob?: 'rent' | 'sale'; // Rent or buy filter
  featured?: '1' | '0'; // Featured properties only
  onlyarea?: '1'; // Return only area data
  noimage?: '1'; // Exclude image data
  
  // Pagination
  limit?: number; // Max 100
  page?: number; // Starting from 1
  
  // Filtering
  area?: string; // Area/postcode filter
  beds?: number; // Minimum bedrooms
  maxprice?: number; // Maximum price
  minprice?: number; // Minimum price
  type?: string; // Property type
  
  // Search
  search?: string; // Full text search
  
  // Sorting
  orderby?: 'price' | 'beds' | 'date' | 'featured';
  order?: 'asc' | 'desc';
}

// Transformed types for our API
export interface PropertyListing {
  propref: string;
  displayaddress: string;
  displayprice: string;
  beds: number;
  baths: number;
  type: string;
  status: string;
  featured: boolean;
  thumbnailUrl?: string;
  area: string;
  geolocation?: [number, number]; // [lat, lng]
  available: string;
  rentorbuy: 'rent' | 'sale' | 'both';
}

export interface PropertyDetail extends PropertyListing {
  // Full address
  address: {
    number: string;
    street: string;
    address1: string;
    address2: string;
    address3: string;
    address4: string;
    postcode: string;
  };
  
  // Full property details
  rooms: {
    singles: number;
    doubles: number;
    receps: number;
  };
  
  // Description and features
  description: string;
  comments: string;
  strapline: string;
  bullets: string[];
  
  // Property features
  features: {
    heating: string;
    floor: string;
    age: string;
    rating: string;
    furnished: 'furnished' | 'unfurnished' | 'part' | 'flexible';
  };
  
  // Financial details
  financial: {
    rentmonth?: string;
    deposit?: string;
    fees?: string;
    counciltax?: string;
  };
  
  // Media URLs (processed)
  media: {
    photos: string[];
    floorplan?: string;
    epc?: string;
    brochure?: string;
  };
  
  // Contact information
  contact: {
    negotiator: string;
    branch: string;
    telephone: string;
    mobile: string;
    email: string;
  };
  
  // Metadata
  metadata: {
    lastchanged: string;
    dateadded: string;
    shortlet: boolean;
  };
}

export interface NegotiatorInfo {
  name: string;
  email: string;
  mobile: string;
  telephone: string;
  branch: string;
}

export interface PropertyMedia {
  filename: string;
  caption: string;
  type: 'photo' | 'floorplan' | 'epc' | 'brochure';
  urls: {
    thumbnail: string;
    card: string;
    full: string;
  };
  metadata: {
    width: number;
    height: number;
    size: number;
    format: string;
  };
  order: number;
}

// API Error types
export interface RentmanApiError {
  error: string;
  code: number;
  message: string;
  details?: any;
}

export type RentmanRobFilter = 'rent' | 'sale';
export type RentmanFurnishedType = 'furnished' | 'unfurnished' | 'part' | 'flexible';