# Auto-Featured Property System

## Overview

The Auto-Featured Property System intelligently selects 7 properties from active listings to display on the website's featured section. This eliminates manual management while ensuring fresh, diverse, and available content for visitors.

***

## 1. System Architecture

### 1.1. Core Components
```
┌─────────────────┐
│ Property Pool   │ ← All active/available properties
├─────────────────┤
│ Smart Selector  │ ← Algorithm for intelligent selection
├─────────────────┤
│ Auto Refresher  │ ← Scheduled updates and triggers
├─────────────────┤
│ Admin Interface │ ← Configuration and monitoring
└─────────────────┘
```

### 1.2. Selection Flow
```
Active Properties → Filter & Score → Smart Selection → Cache → API Response
       ↓                ↓              ↓           ↓         ↓
   Availability    Diversity      Random +     Redis     Website
   Status Check    Scoring        Weighted     Cache     Display
```

***

## 2. Smart Selection Algorithm

### 2.1. Property Scoring System
```typescript
// src/services/property-selector.ts
export class PropertySelector {
  private scoringWeights = {
    availability: 0.3,      // Property status and availability date
    diversity: 0.25,        // Geographic and type diversity
    quality: 0.2,           // Image quality and completeness
    recency: 0.15,          // How recently property was added/updated
    performance: 0.1        // Historical view/engagement metrics
  };
  
  async selectFeaturedProperties(count: number = 7): Promise<PropertyListing[]> {
    // 1. Get all active properties
    const activeProperties = await this.getActiveProperties();
    
    // 2. Score each property
    const scoredProperties = await this.scoreProperties(activeProperties);
    
    // 3. Apply diversity constraints
    const diverseSelection = await this.ensureDiversity(scoredProperties, count);
    
    // 4. Add randomization factor
    const finalSelection = this.addRandomization(diverseSelection, count);
    
    return finalSelection;
  }
  
  private async scoreProperties(properties: Property[]): Promise<ScoredProperty[]> {
    return Promise.all(properties.map(async (property) => {
      const scores = {
        availability: this.scoreAvailability(property),
        diversity: await this.scoreDiversity(property),
        quality: await this.scoreQuality(property),
        recency: this.scoreRecency(property),
        performance: await this.scorePerformance(property)
      };
      
      const totalScore = Object.entries(scores).reduce(
        (sum, [key, score]) => sum + (score * this.scoringWeights[key]), 0
      );
      
      return { ...property, score: totalScore, scores };
    }));
  }
  
  private scoreAvailability(property: Property): number {
    // Higher score for "Available" status
    if (property.status === 'Available') return 1.0;
    if (property.status === 'Under Offer') return 0.3;
    return 0.1;
  }
  
  private async scoreDiversity(property: Property): Promise<number> {
    // Check area distribution in current selection
    const currentAreas = await this.getCurrentFeaturedAreas();
    const areaOverrepresented = currentAreas.filter(a => a === property.area).length > 1;
    
    return areaOverrepresented ? 0.3 : 1.0;
  }
  
  private async scoreQuality(property: Property): Promise<number> {
    let score = 0.5; // Base score
    
    // Bonus for having photos
    if (property.photos && property.photos.length > 0) score += 0.3;
    if (property.photos && property.photos.length >= 3) score += 0.2;
    
    // Bonus for complete description
    if (property.description && property.description.length > 100) score += 0.2;
    
    // Bonus for floorplan
    if (property.floorplan) score += 0.1;
    
    return Math.min(score, 1.0);
  }
}
```

### 2.2. Diversity Constraints
```typescript
// Ensure geographic and type diversity
export class DiversityManager {
  async ensureDiversity(
    scoredProperties: ScoredProperty[], 
    targetCount: number
  ): Promise<ScoredProperty[]> {
    const selected: ScoredProperty[] = [];
    const remaining = [...scoredProperties].sort((a, b) => b.score - a.score);
    
    // Track diversity metrics
    const areaCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    const priceRanges = new Map<string, number>();
    
    while (selected.length < targetCount && remaining.length > 0) {
      const candidate = remaining.shift()!;
      
      // Check diversity constraints
      if (this.meetsDiversityRequirements(candidate, {
        areaCounts,
        typeCounts,
        priceRanges,
        maxPerArea: 2,
        maxPerType: 3,
        maxPerPriceRange: 3
      })) {
        selected.push(candidate);
        this.updateDiversityCounters(candidate, { areaCounts, typeCounts, priceRanges });
      }
    }
    
    return selected;
  }
  
  private meetsDiversityRequirements(
    property: ScoredProperty,
    constraints: DiversityConstraints
  ): boolean {
    const { areaCounts, typeCounts, priceRanges, maxPerArea, maxPerType, maxPerPriceRange } = constraints;
    
    // Check area constraint
    if ((areaCounts.get(property.area) || 0) >= maxPerArea) return false;
    
    // Check type constraint
    if ((typeCounts.get(property.type) || 0) >= maxPerType) return false;
    
    // Check price range constraint
    const priceRange = this.getPriceRange(property.rentmonth);
    if ((priceRanges.get(priceRange) || 0) >= maxPerPriceRange) return false;
    
    return true;
  }
}
```

***

## 3. Auto-Refresh System

### 3.1. Refresh Triggers
```typescript
// src/services/auto-featured.ts
export class AutoFeaturedService {
  private refreshTriggers = [
    'scheduled',        // Time-based refresh
    'availability',     // Property becomes unavailable
    'performance',      // Low engagement metrics
    'manual'           // Admin-triggered refresh
  ];
  
  async scheduleRefresh(): Promise<void> {
    const config = await this.getConfiguration();
    
    switch (config.refreshInterval) {
      case 'hourly':
        this.scheduleJob('0 * * * *', this.refreshFeaturedProperties);
        break;
      case '4hours':
        this.scheduleJob('0 */4 * * *', this.refreshFeaturedProperties);
        break;
      case 'daily':
        this.scheduleJob('0 2 * * *', this.refreshFeaturedProperties);
        break;
      case 'weekly':
        this.scheduleJob('0 2 * * 0', this.refreshFeaturedProperties);
        break;
    }
  }
  
  async refreshFeaturedProperties(trigger: string = 'scheduled'): Promise<FeaturedRefreshResult> {
    try {
      const startTime = Date.now();
      
      // Get new selection
      const newFeatured = await this.propertySelector.selectFeaturedProperties(7);
      
      // Validate selection
      if (newFeatured.length < 7) {
        const available = await this.getAvailablePropertiesCount();
        if (available < 7) {
          console.warn(`Only ${available} properties available, showing ${newFeatured.length}`);
        }
      }
      
      // Process images for new properties
      await this.preloadFeaturedImages(newFeatured);
      
      // Cache new selection
      await this.cacheFeaturedProperties(newFeatured);
      
      // Update metadata
      const refreshData: FeaturedMetadata = {\n        properties: newFeatured,\n        lastRefresh: new Date(),\n        nextRefresh: this.calculateNextRefresh(),\n        trigger,\n        selectionTime: Date.now() - startTime,\n        diversityScore: this.calculateDiversityScore(newFeatured)\n      };\n      \n      await this.updateFeaturedMetadata(refreshData);\n      \n      // Invalidate related caches\n      await cacheService.invalidatePattern('properties:auto-featured');\n      \n      // Notify admin interface\n      await this.notifyRefresh(refreshData);\n      \n      return {\n        success: true,\n        properties: newFeatured,\n        trigger,\n        metadata: refreshData\n      };\n      \n    } catch (error) {\n      console.error('Featured property refresh failed:', error);\n      \n      // Try to return cached selection as fallback\n      const cached = await this.getCachedFeaturedProperties();\n      if (cached) {\n        return {\n          success: false,\n          properties: cached.properties,\n          error: error.message,\n          fallback: true\n        };\n      }\n      \n      throw error;\n    }\n  }\n  \n  private async preloadFeaturedImages(properties: PropertyListing[]): Promise<void> {\n    const imagePromises = properties.map(async (property) => {\n      if (property.photo1) {\n        // Trigger thumbnail generation in background\n        imageProcessor.getThumbnailUrl(property.photo1).catch(error => {\n          console.warn(`Failed to preload image for property ${property.propref}:`, error);\n        });\n      }\n    });\n    \n    await Promise.allSettled(imagePromises);\n  }\n}\n```\n\n### 3.2. Availability Monitoring\n```typescript\n// Monitor property availability and trigger refresh if needed\nexport class AvailabilityMonitor {\n  async monitorAvailability(): Promise<void> {\n    const currentFeatured = await this.getCurrentFeaturedProperties();\n    const unavailableCount = await this.checkAvailability(currentFeatured);\n    \n    // Trigger refresh if more than 2 properties become unavailable\n    if (unavailableCount > 2) {\n      await autoFeaturedService.refreshFeaturedProperties('availability');\n    }\n    // Trigger refresh if any property has been unavailable for > 24 hours\n    else if (await this.hasStaleUnavailable(currentFeatured)) {\n      await autoFeaturedService.refreshFeaturedProperties('availability');\n    }\n  }\n  \n  private async checkAvailability(properties: PropertyListing[]): Promise<number> {\n    let unavailableCount = 0;\n    \n    for (const property of properties) {\n      try {\n        const current = await rentmanClient.getProperty(property.propref);\n        if (current.status !== 'Available') {\n          unavailableCount++;\n        }\n      } catch (error) {\n        // Property might be deleted\n        unavailableCount++;\n      }\n    }\n    \n    return unavailableCount;\n  }\n}\n```\n\n***\n\n## 4. Configuration System\n\n### 4.1. Configuration Schema\n```typescript\ninterface AutoFeaturedConfig {\n  refreshInterval: 'hourly' | '4hours' | 'daily' | 'weekly';\n  \n  // Selection preferences\n  rentPercentage: number;        // 0-100, percentage of rent properties\n  salePercentage: number;        // 0-100, percentage of sale properties\n  \n  // Diversity settings\n  geographicDiversity: boolean;  // Ensure different areas represented\n  priceRangeDiversity: boolean;  // Ensure different price ranges\n  typeVariety: boolean;          // Mix of flats, houses, etc.\n  \n  // Constraints\n  excludedAreas: string[];       // Areas to exclude from selection\n  excludedTypes: string[];       // Property types to exclude\n  minBedrooms?: number;          // Minimum bedrooms filter\n  maxPrice?: number;             // Maximum price filter\n  \n  // Performance settings\n  enablePerformanceTracking: boolean;\n  performanceWeight: number;     // 0-1, weight of engagement metrics\n  \n  // Fallback settings\n  fallbackToManual: boolean;     // Fall back to manual selection if auto fails\n  minimumProperties: number;     // Minimum properties required (default: 5)\n}\n\ninterface FeaturedMetadata {\n  properties: PropertyListing[];\n  lastRefresh: Date;\n  nextRefresh: Date;\n  trigger: string;\n  selectionTime: number;\n  diversityScore: number;\n  config: AutoFeaturedConfig;\n}\n```\n\n### 4.2. Configuration Management\n```typescript\nexport class ConfigurationManager {\n  private defaultConfig: AutoFeaturedConfig = {\n    refreshInterval: '4hours',\n    rentPercentage: 70,\n    salePercentage: 30,\n    geographicDiversity: true,\n    priceRangeDiversity: true,\n    typeVariety: true,\n    excludedAreas: [],\n    excludedTypes: [],\n    enablePerformanceTracking: true,\n    performanceWeight: 0.1,\n    fallbackToManual: false,\n    minimumProperties: 5\n  };\n  \n  async getConfiguration(): Promise<AutoFeaturedConfig> {\n    const stored = await db.query.featuredConfig.findFirst();\n    return stored ? { ...this.defaultConfig, ...stored } : this.defaultConfig;\n  }\n  \n  async updateConfiguration(updates: Partial<AutoFeaturedConfig>): Promise<void> {\n    const current = await this.getConfiguration();\n    const newConfig = { ...current, ...updates };\n    \n    // Validate configuration\n    this.validateConfiguration(newConfig);\n    \n    // Save to database\n    await db.insert(featuredConfig)\n      .values(newConfig)\n      .onConflictDoUpdate({\n        target: [featuredConfig.id],\n        set: newConfig\n      });\n    \n    // Update scheduler if refresh interval changed\n    if (updates.refreshInterval) {\n      await autoFeaturedService.rescheduleRefresh();\n    }\n    \n    // Trigger refresh if significant changes\n    if (this.requiresRefresh(updates)) {\n      await autoFeaturedService.refreshFeaturedProperties('config_update');\n    }\n  }\n  \n  private validateConfiguration(config: AutoFeaturedConfig): void {\n    if (config.rentPercentage + config.salePercentage !== 100) {\n      throw new Error('Rent and sale percentages must sum to 100');\n    }\n    \n    if (config.performanceWeight < 0 || config.performanceWeight > 1) {\n      throw new Error('Performance weight must be between 0 and 1');\n    }\n    \n    if (config.minimumProperties < 1 || config.minimumProperties > 7) {\n      throw new Error('Minimum properties must be between 1 and 7');\n    }\n  }\n}\n```\n\n***\n\n## 5. API Integration\n\n### 5.1. Public API Endpoints\n```typescript\n// GET /api/properties/featured - Auto-selected properties\napp.get('/api/properties/featured', async (c) => {\n  try {\n    const featured = await cacheService.getWithSWR(\n      'properties:auto-featured',\n      () => autoFeaturedService.getCurrentFeaturedProperties(),\n      1800, 3600 // 30min fresh, 60min stale\n    );\n    \n    return c.json({\n      data: featured.properties,\n      meta: {\n        autoGenerated: true,\n        lastRefresh: featured.lastRefresh,\n        nextRefresh: featured.nextRefresh,\n        diversityScore: featured.diversityScore,\n        selectionTrigger: featured.trigger\n      }\n    });\n  } catch (error) {\n    // Fallback to basic property list if auto-featured fails\n    const fallback = await rentmanClient.getProperties({ \n      limit: 7, \n      rob: 'rent',\n      status: 'Available'\n    });\n    \n    return c.json({\n      data: fallback.slice(0, 7),\n      meta: {\n        autoGenerated: false,\n        fallback: true,\n        error: 'Auto-featured service unavailable'\n      }\n    });\n  }\n});\n```\n\n### 5.2. Admin API Endpoints\n```typescript\n// POST /admin/api/featured/refresh - Manual refresh\napp.post('/admin/api/featured/refresh', adminAuth, async (c) => {\n  const userId = c.get('userId');\n  \n  try {\n    const result = await autoFeaturedService.refreshFeaturedProperties('manual');\n    \n    await auditLogger.log('featured_manual_refresh', {\n      userId,\n      propertiesSelected: result.properties.length,\n      selectionTime: result.metadata.selectionTime\n    });\n    \n    return c.json({\n      success: true,\n      data: result.properties,\n      metadata: result.metadata\n    });\n  } catch (error) {\n    return c.json({ error: 'Failed to refresh featured properties' }, 500);\n  }\n});\n\n// GET /admin/api/featured/config - Get configuration\napp.get('/admin/api/featured/config', adminAuth, async (c) => {\n  const config = await configManager.getConfiguration();\n  return c.json({ data: config });\n});\n\n// PUT /admin/api/featured/config - Update configuration\napp.put('/admin/api/featured/config', adminAuth, async (c) => {\n  const userId = c.get('userId');\n  const updates = await c.req.json();\n  \n  try {\n    await configManager.updateConfiguration(updates);\n    \n    await auditLogger.log('featured_config_updated', {\n      userId,\n      changes: updates\n    });\n    \n    return c.json({ success: true });\n  } catch (error) {\n    return c.json({ error: error.message }, 400);\n  }\n});\n\n// GET /admin/api/featured/analytics - Performance analytics\napp.get('/admin/api/featured/analytics', adminAuth, async (c) => {\n  const analytics = await autoFeaturedService.getPerformanceAnalytics();\n  return c.json({ data: analytics });\n});\n```\n\n***\n\n## 6. Performance Analytics\n\n### 6.1. Engagement Tracking\n```typescript\nexport class FeaturedAnalytics {\n  async trackEngagement(propref: string, event: 'view' | 'click' | 'inquiry'): Promise<void> {\n    await db.insert(featuredEngagement).values({\n      propref,\n      event,\n      timestamp: new Date(),\n      source: 'featured_section'\n    });\n  }\n  \n  async getPerformanceMetrics(period: string = '7d'): Promise<FeaturedPerformance> {\n    const metrics = await db.query.featuredEngagement.findMany({\n      where: gte(featuredEngagement.timestamp, this.getPeriodStart(period)),\n      orderBy: desc(featuredEngagement.timestamp)\n    });\n    \n    return {\n      totalViews: metrics.filter(m => m.event === 'view').length,\n      totalClicks: metrics.filter(m => m.event === 'click').length,\n      totalInquiries: metrics.filter(m => m.event === 'inquiry').length,\n      clickThroughRate: this.calculateCTR(metrics),\n      topPerformers: this.getTopPerformers(metrics),\n      diversityEffectiveness: await this.calculateDiversityEffectiveness()\n    };\n  }\n  \n  async optimizeSelection(): Promise<SelectionOptimization> {\n    const performance = await this.getPerformanceMetrics('30d');\n    const recommendations: string[] = [];\n    \n    // Analyze performance patterns\n    if (performance.clickThroughRate < 0.05) {\n      recommendations.push('Consider increasing image quality requirements');\n    }\n    \n    if (performance.diversityEffectiveness < 0.7) {\n      recommendations.push('Improve geographic diversity in selection');\n    }\n    \n    const underperformingAreas = performance.topPerformers\n      .filter(p => p.conversionRate < 0.02)\n      .map(p => p.area);\n    \n    if (underperformingAreas.length > 0) {\n      recommendations.push(`Consider excluding areas: ${underperformingAreas.join(', ')}`);\n    }\n    \n    return {\n      recommendations,\n      suggestedConfig: this.generateOptimizedConfig(performance),\n      expectedImprovement: this.estimateImprovement(performance)\n    };\n  }\n}\n```\n\n### 6.2. A/B Testing Framework\n```typescript\nexport class FeaturedABTesting {\n  async runSelectionExperiment(): Promise<ExperimentResult> {\n    const variants = [\n      { name: 'current', config: await configManager.getConfiguration() },\n      { name: 'diversity_focused', config: { ...config, diversityWeight: 0.4 } },\n      { name: 'performance_focused', config: { ...config, performanceWeight: 0.3 } }\n    ];\n    \n    const results = await Promise.all(\n      variants.map(async variant => {\n        const selection = await this.testSelection(variant.config);\n        const predictedPerformance = await this.predictPerformance(selection);\n        \n        return {\n          variant: variant.name,\n          selection,\n          predictedCTR: predictedPerformance.ctr,\n          diversityScore: this.calculateDiversityScore(selection)\n        };\n      })\n    );\n    \n    return {\n      results,\n      recommendation: this.selectBestVariant(results),\n      confidenceLevel: this.calculateConfidence(results)\n    };\n  }\n}\n```\n\nThis comprehensive Auto-Featured Property System ensures your website always displays 7 fresh, diverse, and available properties without any manual intervention, while providing powerful configuration and monitoring capabilities for optimal performance.