# Admin Frontend System

## Overview

The Admin Frontend provides a comprehensive web-based interface for monitoring auto-featured properties, configuring selection criteria, and analyzing API usage. Built with modern React/Next.js, it offers real-time updates and intelligent property management capabilities.

***

## 1. System Architecture

### 1.1. Tech Stack
- **Frontend**: React 18, Next.js 14, TypeScript
- **State Management**: TanStack Query (React Query), Zustand
- **UI Components**: Tailwind CSS, shadcn/ui, Radix UI
- **Real-time**: WebSocket connection, Server-Sent Events
- **Authentication**: JWT tokens, Next-Auth.js
- **Charts/Analytics**: Recharts, D3.js for advanced visualizations

### 1.2. Project Structure
```
src/admin-frontend/
├── components/
│   ├── ui/                 # Base UI components (shadcn/ui)
│   ├── layout/
│   │   ├── AdminLayout.tsx
│   │   ├── Sidebar.tsx
│   │   └── TopBar.tsx
│   ├── properties/
│   │   ├── PropertyList.tsx
│   │   ├── PropertyCard.tsx
│   │   └── PropertyFilters.tsx
│   ├── featured/
│   │   ├── AutoFeaturedDashboard.tsx
│   │   ├── FeaturedConfiguration.tsx
│   │   ├── FeaturedPreview.tsx
│   │   └── RefreshControls.tsx
│   ├── cache/
│   │   ├── CacheStatus.tsx
│   │   ├── CacheMetrics.tsx
│   │   └── InvalidationControls.tsx
│   └── analytics/
│       ├── Dashboard.tsx
│       ├── PopularProperties.tsx
│       └── PerformanceCharts.tsx
├── pages/
│   ├── login.tsx
│   ├── dashboard.tsx
│   ├── properties.tsx
│   ├── featured.tsx
│   ├── cache.tsx
│   └── analytics.tsx
├── hooks/
│   ├── useProperties.ts
│   ├── useAutoFeatured.ts
│   ├── useCache.ts
│   ├── useAuth.ts
│   └── useWebSocket.ts
├── lib/
│   ├── api.ts
│   ├── auth.ts
│   ├── websocket.ts
│   └── utils.ts
├── types/
│   ├── admin.ts
│   ├── properties.ts
│   └── api.ts
└── styles/
    └── globals.css
```

***

## 2. Authentication System

### 2.1. JWT-Based Authentication
```typescript
// lib/auth.ts
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'editor';
  permissions: string[];
}

export class AuthService {
  async login(email: string, password: string): Promise<{ token: string; user: AdminUser }> {
    // Verify credentials
    const user = await this.verifyCredentials(email, password);
    if (!user) {
      throw new Error('Invalid credentials');
    }
    
    // Generate JWT
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    );
    
    return { token, user };
  }
  
  async verifyToken(token: string): Promise<AdminUser | null> {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      return await this.getUserById(decoded.userId);
    } catch (error) {
      return null;
    }
  }
  
  private async verifyCredentials(email: string, password: string): Promise<AdminUser | null> {
    const user = await db.query.adminUsers.findFirst({
      where: eq(adminUsers.email, email)
    });
    
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return null;
    }
    
    return {
      id: user.id,
      email: user.email,
      role: user.role as 'admin' | 'editor',
      permissions: user.permissions
    };
  }
}
```

### 2.2. Protected Routes & Middleware
```typescript
// middleware/auth.ts
export const adminAuth = async (c: Context, next: () => Promise<void>) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  
  const user = await authService.verifyToken(token);
  if (!user) {
    return c.json({ error: 'Invalid token' }, 401);
  }
  
  c.set('user', user);
  await next();
};

// Permission-based access
export const requirePermission = (permission: string) => {
  return async (c: Context, next: () => Promise<void>) => {
    const user = c.get('user') as AdminUser;
    
    if (!user.permissions.includes(permission) && user.role !== 'admin') {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    
    await next();
  };
};
```

***

## 3. Property Management Interface

### 3.1. Property List Component
```typescript
// components/properties/PropertyList.tsx
import { useProperties } from '../hooks/useProperties';
import { PropertyCard } from './PropertyCard';
import { BulkActions } from './BulkActions';

export const PropertyList: React.FC = () => {
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({
    search: '',
    featured: 'all',
    status: 'all',
    page: 1,
    limit: 20
  });
  
  const { 
    data: properties, 
    isLoading, 
    error,
    refetch 
  } = useProperties(filters);
  
  const handleSelectProperty = (propref: string, selected: boolean) => {
    const newSelected = new Set(selectedProperties);
    if (selected) {
      newSelected.add(propref);
    } else {
      newSelected.delete(propref);
    }
    setSelectedProperties(newSelected);
  };
  
  const handleBulkAction = async (action: 'feature' | 'unfeature') => {
    await bulkUpdateFeatured(Array.from(selectedProperties), action === 'feature');
    setSelectedProperties(new Set());
    refetch();
  };
  
  if (isLoading) return <PropertyListSkeleton />;
  if (error) return <ErrorMessage error={error} />;
  
  return (
    <div className="space-y-6">
      {/* Filters & Search */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex gap-4">
          <Input
            placeholder="Search properties..."
            value={filters.search}
            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            className="w-64"
          />
          <Select
            value={filters.featured}
            onValueChange={(value) => setFilters(prev => ({ ...prev, featured: value }))}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Featured" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Properties</SelectItem>
              <SelectItem value="featured">Featured Only</SelectItem>
              <SelectItem value="unfeatured">Not Featured</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        </div>
      </Card>
      
      {/* Configuration */}
      <FeaturedConfiguration 
        config={config}
        onConfigChange={updateConfig}
      />
      
      {/* Performance Metrics */}
      <FeaturedPerformanceMetrics />
    </div>
  );
};
```

### 3.2. Featured Configuration Component
```typescript
// components/featured/FeaturedConfiguration.tsx
export const FeaturedConfiguration: React.FC<ConfigProps> = ({ config, onConfigChange }) => {
  const [localConfig, setLocalConfig] = useState(config);
  const [hasChanges, setHasChanges] = useState(false);
  
  const handleConfigUpdate = (updates: Partial<FeaturedConfig>) => {
    const newConfig = { ...localConfig, ...updates };
    setLocalConfig(newConfig);
    setHasChanges(true);
  }; 
  propref, 
  featured, 
  disabled 
}) => {
  const queryClient = useQueryClient();
  
  const mutation = useMutation({
    mutationFn: (newFeatured: boolean) => 
      updatePropertyFeatured(propref, newFeatured),
    onMutate: async (newFeatured) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['properties'] });
      
      const previousData = queryClient.getQueryData(['properties']);
      
      queryClient.setQueryData(['properties'], (old: any) => {
        if (!old) return old;
        
        return {
          ...old,
          data: old.data.map((prop: any) =>
            prop.propref === propref 
              ? { ...prop, featured: newFeatured }
              : prop
          )
        };
      });
      
      return { previousData };
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['properties'], context.previousData);
      }
      toast.error('Failed to update featured status');
    },
    onSuccess: () => {
      toast.success(`Property ${featured ? 'unfeatured' : 'featured'} successfully`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['featured-properties'] });
    }
  });
  
  return (
    <div className="flex items-center space-x-2">
      <Switch
        checked={featured}
        onCheckedChange={(checked) => mutation.mutate(checked)}
        disabled={disabled || mutation.isPending}
      />
      <Label className="text-sm">
        Featured {mutation.isPending && <Spinner className="ml-2 w-4 h-4" />}
      </Label>
    </div>
  );
};
```

***

## 4. Real-Time Updates

### 4.1. WebSocket Integration
```typescript
// hooks/useWebSocket.ts
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export const useWebSocket = (url: string) => {
  const ws = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  
  useEffect(() => {
    ws.current = new WebSocket(url);
    
    ws.current.onopen = () => {
      console.log('WebSocket connected');
    };
    
    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'PROPERTY_UPDATED':
          queryClient.invalidateQueries({ queryKey: ['properties'] });
          break;
        case 'CACHE_INVALIDATED':
          queryClient.invalidateQueries({ queryKey: ['cache-metrics'] });
          break;
        case 'FEATURED_CHANGED':
          queryClient.invalidateQueries({ queryKey: ['featured-properties'] });
          toast.info(`Property ${data.propref} featured status changed`);
          break;
      }
    };
    
    ws.current.onclose = () => {
      console.log('WebSocket disconnected');
      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        if (ws.current?.readyState === WebSocket.CLOSED) {
          ws.current = new WebSocket(url);
        }
      }, 3000);
    };
    
    return () => {
      ws.current?.close();
    };
  }, [url, queryClient]);
  
  const sendMessage = (message: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    }
  };
  
  return { sendMessage };
};
```

### 4.2. Live Cache Monitoring
```typescript
// components/cache/CacheStatus.tsx
import { useWebSocket } from '../hooks/useWebSocket';
import { useCacheMetrics } from '../hooks/useCache';

export const CacheStatus: React.FC = () => {
  const { data: metrics, isLoading } = useCacheMetrics();
  const [liveMetrics, setLiveMetrics] = useState(metrics);
  
  const { sendMessage } = useWebSocket(
    `${process.env.NEXT_PUBLIC_WS_URL}/admin/cache`
  );
  
  useEffect(() => {
    const handleCacheUpdate = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      if (data.type === 'CACHE_METRICS_UPDATE') {
        setLiveMetrics(data.metrics);
      }
    };
    
    // Subscribe to cache updates
    sendMessage({ type: 'SUBSCRIBE_CACHE_METRICS' });
    
    return () => {
      sendMessage({ type: 'UNSUBSCRIBE_CACHE_METRICS' });
    };
  }, [sendMessage]);
  
  const currentMetrics = liveMetrics || metrics;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <MetricCard
        title="Cache Hit Rate"
        value={`${(currentMetrics?.hitRate * 100).toFixed(1)}%`}
        trend={currentMetrics?.hitRateTrend}
        color="green"
      />
      <MetricCard
        title="Total Requests"
        value={currentMetrics?.totalRequests.toLocaleString()}
        trend={currentMetrics?.requestsTrend}
        color="blue"
      />
      <MetricCard
        title="Avg Response Time"
        value={`${currentMetrics?.avgResponseTime}ms`}
        trend={currentMetrics?.responseTimeTrend}
        color="purple"
      />
      <MetricCard
        title="Cache Size"
        value={formatBytes(currentMetrics?.cacheSize)}
        trend={currentMetrics?.cacheSizeTrend}
        color="orange"
      />
    </div>
  );
};
```

***

## 5. Analytics Dashboard

### 5.1. Popular Properties Analytics
```typescript
// components/analytics/PopularProperties.tsx
import { usePopularProperties } from '../hooks/useAnalytics';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export const PopularProperties: React.FC = () => {
  const { data: popularProps, isLoading } = usePopularProperties();
  
  if (isLoading) return <AnalyticsSkeleton />;
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Most Viewed Properties (Last 7 Days)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={popularProps?.data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="displayaddress" 
              angle={-45}
              textAnchor="end"
              height={100}
            />
            <YAxis />
            <Tooltip 
              formatter={(value) => [value, 'Views']}
              labelFormatter={(label) => `Property: ${label}`}
            />
            <Bar dataKey="views" fill="#3B82F6" />
          </BarChart>
        </ResponsiveContainer>
        
        <div className="mt-6 space-y-4">
          {popularProps?.data.slice(0, 5).map((prop, index) => (
            <div key={prop.propref} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-600 rounded-full text-sm font-medium">
                  {index + 1}
                </div>
                <div>
                  <p className="font-medium">{prop.displayaddress}</p>
                  <p className="text-sm text-gray-500">{prop.displayprice}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-lg">{prop.views.toLocaleString()}</p>
                <p className="text-sm text-gray-500">views</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
```

### 5.2. Performance Monitoring
```typescript
// components/analytics/PerformanceCharts.tsx
export const PerformanceCharts: React.FC = () => {
  const { data: performanceData } = usePerformanceMetrics();
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Response Time Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Response Times (Last 24 Hours)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={performanceData?.responseTime}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="timestamp" 
                tickFormatter={(time) => new Date(time).toLocaleTimeString()}
              />
              <YAxis />
              <Tooltip 
                labelFormatter={(time) => new Date(time).toLocaleString()}
                formatter={(value) => [`${value}ms`, 'Response Time']}
              />
              <Line 
                type="monotone" 
                dataKey="avgResponseTime" 
                stroke="#3B82F6" 
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      
      {/* Error Rate Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Error Rates</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={performanceData?.errorRate}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="timestamp"
                tickFormatter={(time) => new Date(time).toLocaleTimeString()}
              />
              <YAxis />
              <Tooltip 
                labelFormatter={(time) => new Date(time).toLocaleString()}
                formatter={(value) => [`${value}%`, 'Error Rate']}
              />
              <Area 
                type="monotone" 
                dataKey="errorRate" 
                stroke="#EF4444" 
                fill="#EF4444" 
                fillOpacity={0.3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};
```

***

## 6. Cache Management Interface

### 6.1. Cache Invalidation Controls
```typescript
// components/cache/InvalidationControls.tsx
export const InvalidationControls: React.FC = () => {
  const [selectedPattern, setSelectedPattern] = useState('');
  const invalidationMutation = useMutation({
    mutationFn: (pattern: string) => invalidateCache(pattern),
    onSuccess: () => {
      toast.success('Cache invalidated successfully');
      queryClient.invalidateQueries({ queryKey: ['cache-metrics'] });
    },
    onError: () => {
      toast.error('Failed to invalidate cache');
    }
  });
  
  const presetPatterns = [
    { label: 'All Properties', value: 'properties:*' },
    { label: 'Featured Properties', value: 'featured' },
    { label: 'All Images', value: 'image:*' },
    { label: 'Property Media', value: 'media:*' },
    { label: 'Search Results', value: 'search:*' }
  ];
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cache Invalidation</CardTitle>
        <CardDescription>
          Clear cached data to force fresh API calls. Use with caution in production.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {presetPatterns.map((preset) => (
            <Button
              key={preset.value}
              variant="outline"
              onClick={() => invalidationMutation.mutate(preset.value)}
              disabled={invalidationMutation.isPending}
              className="justify-start"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {preset.label}
            </Button>
          ))}
        </div>
        
        <Separator />
        
        <div className="flex space-x-2">
          <Input
            placeholder="Enter custom pattern (e.g., property:123)"
            value={selectedPattern}
            onChange={(e) => setSelectedPattern(e.target.value)}
          />
          <Button
            onClick={() => invalidationMutation.mutate(selectedPattern)}
            disabled={!selectedPattern || invalidationMutation.isPending}
          >
            {invalidationMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Invalidate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
```

***

## 7. API Integration

### 7.1. Admin API Client
```typescript
// lib/api.ts
export class AdminApiClient {
  private baseUrl: string;
  private token: string | null = null;
  
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.token = localStorage.getItem('admin_token');
  }
  
  private async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
      ...options.headers
    };
    
    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    
    return response.json();
  }
  
  // Property management
  async getProperties(filters: PropertyFilters): Promise<PaginatedResponse<Property>> {
    const params = new URLSearchParams(filters as any).toString();
    return this.request(`/admin/api/properties?${params}`);
  }
  
  async updatePropertyFeatured(propref: string, featured: boolean): Promise<void> {
    return this.request(`/admin/api/properties/${propref}/featured`, {
      method: 'POST',
      body: JSON.stringify({ featured })
    });
  }
  
  async bulkUpdateFeatured(proprefs: string[], featured: boolean): Promise<void> {
    return this.request('/admin/api/properties/bulk/featured', {
      method: 'POST',
      body: JSON.stringify({ proprefs, featured })
    });
  }
  
  // Cache management
  async getCacheMetrics(): Promise<CacheMetrics> {
    return this.request('/admin/api/cache/metrics');
  }
  
  async invalidateCache(pattern: string): Promise<void> {
    return this.request('/admin/api/cache/invalidate', {
      method: 'POST',
      body: JSON.stringify({ pattern })
    });
  }
  
  // Analytics
  async getPopularProperties(): Promise<PopularProperty[]> {
    return this.request('/admin/api/analytics/popular-properties');
  }
  
  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    return this.request('/admin/api/analytics/performance');
  }
}
```

***

## 8. Deployment & Environment Setup

### 8.1. Docker Configuration
```dockerfile
# Dockerfile.admin
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app

COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3001
CMD ["npm", "start"]
```

### 8.2. Environment Variables
```env
# Admin Frontend
NEXT_PUBLIC_API_URL=https://api.london-move.com
NEXT_PUBLIC_WS_URL=wss://api.london-move.com
NEXTAUTH_URL=https://admin.london-move.com
NEXTAUTH_SECRET=your_nextauth_secret

# Database
DATABASE_URL=postgresql://user:password@db:5432/london_move

# Authentication
JWT_SECRET=your_jwt_secret
ADMIN_SESSION_TIMEOUT=86400
```

This comprehensive admin frontend system provides complete property management capabilities while maintaining modern development practices and real-time functionality.