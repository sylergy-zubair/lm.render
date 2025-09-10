import { z } from 'zod';
import type {
  RentmanProperty,
  RentmanApiResponse,
  RentmanMediaResponse,
  RentmanApiParams,
  PropertyListing,
  PropertyDetail,
  RentmanApiError,
} from '@/types/rentman';
import { appConfig } from '@/utils/config';
import { cacheService } from '@/cache/cache-service';

export class RentmanApiError extends Error {
  constructor(
    message: string,
    public code: number,
    public details?: any
  ) {
    super(message);
    this.name = 'RentmanApiError';
  }
}

export class RentmanClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly requestTimeout: number = 180000; // 3 minutes

  constructor() {
    this.baseUrl = appConfig.rentman.baseUrl;
    // URL decode the token in case it's encoded
    this.apiToken = decodeURIComponent(appConfig.rentman.apiToken);
  }

  /**
   * Get properties from Rentman API with full parameter support
   */
  async getProperties(params: RentmanApiParams = {}): Promise<PropertyListing[]> {
    try {
      const queryParams = this.buildQueryParams({
        ...params,
        noimage: params.noimage || '1', // Default to no images for listings
      });

      const response = await this.makeRequest(`/propertyadvertising.php?${queryParams}`);
      const data = await this.parseResponse<RentmanProperty[]>(response);

      // console.log(`[Rentman] API Response: Got ${data.length} properties`);
      
      if (!Array.isArray(data)) {
        console.error('[Rentman] Invalid response format - expected array');
        return [];
      }

      return await Promise.all(data.map(property => this.transformToListing(property)));
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch properties');
    }
  }

  /**
   * Get a single property with full details
   */
  async getProperty(propref: string): Promise<PropertyDetail> {
    try {
      const queryParams = this.buildQueryParams({ propref });
      const response = await this.makeRequest(`/propertyadvertising.php?${queryParams}`);
      const data = await this.parseResponse<RentmanProperty[]>(response);

      if (!Array.isArray(data) || data.length === 0) {
        throw new RentmanApiError(`Property ${propref} not found`, 404);
      }

      return await this.transformToDetail(data[0]);
    } catch (error) {
      throw this.handleError(error, `Failed to fetch property ${propref}`);
    }
  }

  /**
   * Get featured properties
   */
  async getFeaturedProperties(params: Omit<RentmanApiParams, 'featured'> = {}): Promise<PropertyListing[]> {
    return this.getProperties({
      ...params,
      featured: '1',
    });
  }

  /**
   * Get property media by filename
   */
  async getMediaByFilename(filename: string): Promise<RentmanMediaResponse> {
    try {
      const queryParams = this.buildQueryParams({ filename });
      const response = await this.makeRequest(`/propertymedia.php?${queryParams}`);
      const data = await this.parseResponse<RentmanMediaResponse[]>(response);

      // Rentman returns an array, get the first item
      if (!Array.isArray(data) || data.length === 0 || !data[0].base64data) {
        throw new RentmanApiError(`Media ${filename} not found`, 404);
      }

      return data[0];
    } catch (error) {
      throw this.handleError(error, `Failed to fetch media ${filename}`);
    }
  }

  /**
   * Get all media for a property
   */
  async getPropertyMedia(propref: string): Promise<RentmanMediaResponse[]> {
    const property = await this.getProperty(propref);
    const mediaFields = ['photo1', 'photo2', 'photo3', 'photo4', 'photo5', 'photo6', 'photo7', 'photo8', 'photo9', 'floorplan', 'epc', 'brochure'] as const;
    
    const mediaPromises = mediaFields
      .map(field => (property as any)[field])
      .filter(Boolean)
      .map(filename => this.getMediaByFilename(filename));

    const results = await Promise.allSettled(mediaPromises);
    
    return results
      .filter((result): result is PromiseFulfilledResult<RentmanMediaResponse> => 
        result.status === 'fulfilled')
      .map(result => result.value);
  }

  /**
   * Search properties with full-text search
   */
  async searchProperties(query: string, params: RentmanApiParams = {}): Promise<PropertyListing[]> {
    return this.getProperties({
      ...params,
      search: query,
    });
  }

  /**
   * Get unique areas for filtering
   */
  async getAreas(): Promise<string[]> {
    try {
      const queryParams = this.buildQueryParams({ onlyarea: '1' });
      const response = await this.makeRequest(`/propertyadvertising.php?${queryParams}`);
      const data = await this.parseResponse<RentmanProperty[]>(response);

      const areas = [...new Set(data.map(p => p.area).filter(Boolean))];
      return areas.sort();
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch areas');
    }
  }

  /**
   * Health check for Rentman API
   */
  async healthCheck(): Promise<{ status: 'up' | 'down'; responseTime: number }> {
    const startTime = Date.now();
    
    try {
      await this.makeRequest('/propertyadvertising.php?limit=1');
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'up',
        responseTime,
      };
    } catch (error) {
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Build query parameters string
   */
  private buildQueryParams(params: Record<string, any>): string {
    const searchParams = new URLSearchParams();
    
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    
    return searchParams.toString();
  }

  /**
   * Make authenticated request to Rentman API
   */
  private async makeRequest(endpoint: string): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    
    // Add authentication
    const separator = endpoint.includes('?') ? '&' : '?';
    const authenticatedUrl = `${url}${separator}token=${this.apiToken}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

    try {
      const response = await fetch(authenticatedUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'London Move API v1.0.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new RentmanApiError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status
        );
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RentmanApiError('Request timeout', 408);
      }
      
      throw error;
    }
  }

  /**
   * Parse API response with error handling
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    try {
      const text = await response.text();
      
      if (!text) {
        throw new RentmanApiError('Empty response from API', 502);
      }

      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new RentmanApiError('Invalid JSON response from API', 502);
      }
      throw error;
    }
  }

  /**
   * Transform Rentman property to our PropertyListing format
   */
  private async transformToListing(property: RentmanProperty): Promise<PropertyListing> {
    // Check admin-set featured status first, fallback to Rentman
    const adminFeaturedKey = `property:featured:${property.propref}`;
    const adminFeatured = await cacheService.get<boolean>(adminFeaturedKey);
    const isFeatured = adminFeatured !== null ? adminFeatured : property.featured === '1';
    
    return {
      propref: property.propref,
      displayaddress: property.displayaddress,
      displayprice: property.displayprice,
      beds: parseInt(property.beds) || 0,
      baths: parseInt(property.baths) || 0,
      type: property.type,
      status: property.status,
      featured: isFeatured,
      area: property.area,
      geolocation: this.parseGeolocation(property.geolocation),
      available: property.available,
      rentorbuy: this.parseRentOrBuy(property.rentorbuy),
    };
  }

  /**
   * Transform Rentman property to our PropertyDetail format
   */
  private async transformToDetail(property: RentmanProperty): Promise<PropertyDetail> {
    const listing = await this.transformToListing(property);
    
    return {
      ...listing,
      address: {
        number: property.number,
        street: property.street,
        address1: property.address1,
        address2: property.address2,
        address3: property.address3,
        address4: property.address4,
        postcode: property.postcode,
      },
      rooms: {
        singles: parseInt(property.singles) || 0,
        doubles: parseInt(property.doubles) || 0,
        receps: parseInt(property.receps) || 0,
      },
      description: property.description,
      comments: property.comments,
      strapline: property.strapline,
      bullets: property.bullets ? property.bullets.split('\n').filter(Boolean) : [],
      features: {
        heating: property.heating,
        floor: property.floor,
        age: property.age,
        rating: property.rating,
        furnished: this.parseFurnished(property.furnished),
      },
      financial: {
        rentmonth: property.rentmonth,
        deposit: property.deposit,
        fees: property.fees,
        counciltax: property.counciltax,
      },
      media: {
        photos: [
          property.photo1,
          property.photo2,
          property.photo3,
          property.photo4,
          property.photo5,
          property.photo6,
          property.photo7,
          property.photo8,
          property.photo9,
        ].filter(Boolean),
        floorplan: property.floorplan,
        epc: property.epc,
        brochure: property.brochure,
      },
      contact: {
        negotiator: property.negotiator,
        branch: property.branch,
        telephone: property.telephone,
        mobile: property.mobile,
        email: property.email,
      },
      metadata: {
        lastchanged: property.lastchanged,
        dateadded: property.dateadded,
        shortlet: property.shortlet === '1',
      },
    };
  }

  /**
   * Parse geolocation string to coordinates array
   */
  private parseGeolocation(geolocation: string): [number, number] | undefined {
    if (!geolocation || geolocation.trim() === '') {
      return undefined;
    }
    
    const parts = geolocation.split(',');
    if (parts.length !== 2) {
      return undefined;
    }
    
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    
    if (isNaN(lat) || isNaN(lng)) {
      return undefined;
    }
    
    return [lat, lng];
  }

  /**
   * Parse rent or buy code
   */
  private parseRentOrBuy(rentorbuy: string): 'rent' | 'sale' | 'both' {
    switch (rentorbuy) {
      case '1': return 'rent';
      case '2': return 'sale';
      case '3': return 'both';
      default: return 'rent';
    }
  }

  /**
   * Parse furnished code
   */
  private parseFurnished(furnished: string): 'furnished' | 'unfurnished' | 'part' | 'flexible' {
    switch (furnished) {
      case '1': return 'furnished';
      case '2': return 'unfurnished';
      case '3': return 'part';
      case '4': return 'flexible';
      default: return 'unfurnished';
    }
  }

  /**
   * Handle and transform errors
   */
  private handleError(error: unknown, context: string): RentmanApiError {
    if (error instanceof RentmanApiError) {
      return error;
    }
    
    if (error instanceof Error) {
      return new RentmanApiError(`${context}: ${error.message}`, 500, error);
    }
    
    return new RentmanApiError(`${context}: Unknown error`, 500, error);
  }
}

// Export singleton instance
export const rentmanClient = new RentmanClient();