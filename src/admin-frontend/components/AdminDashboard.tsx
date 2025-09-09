import React, { useState, useEffect } from 'react';

interface Property {
  propref: string;
  displayaddress: string;
  displayprice: string;
  beds: number;
  baths: number;
  type: string;
  status: string;
  featured: boolean;
  area: string;
  rentorbuy: 'rent' | 'sale' | 'both';
}

interface HealthData {
  rentman: { status: 'up' | 'down'; responseTime: number };
  cache: { status: 'up' | 'down'; hitRate: number; totalRequests: number };
  server: { status: 'up'; uptime: number; memory: any };
}

export default function AdminDashboard() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [featured, setFeatured] = useState<Property[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'properties' | 'featured' | 'cache' | 'health'>('properties');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [propertiesRes, featuredRes, healthRes] = await Promise.all([
        fetch('/admin/api/properties'),
        fetch('/admin/api/featured'),
        fetch('/admin/api/health'),
      ]);

      const [propertiesData, featuredData, healthData] = await Promise.all([
        propertiesRes.json(),
        featuredRes.json(),
        healthRes.json(),
      ]);

      if (propertiesData.success) setProperties(propertiesData.data);
      if (featuredData.success) setFeatured(featuredData.data);
      if (healthData.success) setHealth(healthData.data);
    } catch (error) {
      console.error('Failed to load admin data:', error);
    }
    setLoading(false);
  };

  const clearCache = async () => {
    try {
      const res = await fetch('/admin/api/cache/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('Cache cleared successfully');
        loadData(); // Reload data
      } else {
        alert('Failed to clear cache');
      }
    } catch (error) {
      alert('Error clearing cache');
    }
  };

  const warmCache = async () => {
    try {
      const res = await fetch('/admin/api/cache/warm', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('Cache warming initiated');
      } else {
        alert('Failed to warm cache');
      }
    } catch (error) {
      alert('Error warming cache');
    }
  };

  const formatBytes = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    return `${bytes.toFixed(1)} ${units[i]}`;
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading admin dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="px-6 py-4">
          <h1 className="text-2xl font-bold text-gray-900">London Move Admin</h1>
        </div>
        <nav className="px-6">
          <div className="flex space-x-8">
            {[
              { key: 'properties', label: 'Properties', count: properties.length },
              { key: 'featured', label: 'Featured', count: featured.length },
              { key: 'cache', label: 'Cache' },
              { key: 'health', label: 'Health' },
            ].map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as any)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {label} {count !== undefined && `(${count})`}
              </button>
            ))}
          </div>
        </nav>
      </div>

      <div className="px-6 py-8">
        {activeTab === 'properties' && (
          <div>
            <h2 className="text-lg font-medium mb-4">All Properties ({properties.length})</h2>
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Property</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Beds/Baths</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Featured</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {properties.map((property) => (
                    <tr key={property.propref} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div>
                          <div className="font-medium text-gray-900">{property.displayaddress}</div>
                          <div className="text-sm text-gray-500">{property.propref}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{property.displayprice}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{property.beds}bed / {property.baths}bath</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{property.type}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          property.status === 'Available' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {property.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          property.featured 
                            ? 'bg-blue-100 text-blue-800' 
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {property.featured ? 'Yes' : 'No'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'featured' && (
          <div>
            <h2 className="text-lg font-medium mb-4">Featured Properties ({featured.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {featured.map((property) => (
                <div key={property.propref} className="bg-white rounded-lg shadow p-6">
                  <h3 className="font-medium text-gray-900 mb-2">{property.displayaddress}</h3>
                  <p className="text-lg font-bold text-blue-600 mb-2">{property.displayprice}</p>
                  <div className="text-sm text-gray-600 space-y-1">
                    <div>{property.beds} beds • {property.baths} baths</div>
                    <div>{property.type}</div>
                    <div>{property.area}</div>
                    <div className="text-xs text-gray-500 mt-2">{property.propref}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'cache' && (
          <div className="space-y-6">
            <div className="flex space-x-4">
              <button
                onClick={clearCache}
                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
              >
                Clear Cache
              </button>
              <button
                onClick={warmCache}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Warm Cache
              </button>
            </div>
            
            {health && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-medium mb-4">Cache Statistics</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-gray-50 p-4 rounded">
                    <div className="text-sm text-gray-500">Hit Rate</div>
                    <div className="text-2xl font-bold">{(health.cache.hitRate * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-gray-50 p-4 rounded">
                    <div className="text-sm text-gray-500">Total Requests</div>
                    <div className="text-2xl font-bold">{health.cache.totalRequests.toLocaleString()}</div>
                  </div>
                  <div className="bg-gray-50 p-4 rounded">
                    <div className="text-sm text-gray-500">Cache Status</div>
                    <div className={`text-lg font-bold ${
                      health.cache.status === 'up' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {health.cache.status.toUpperCase()}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'health' && health && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-medium mb-4">Rentman API</h3>
                <div className="space-y-2">
                  <div className={`inline-block px-2 py-1 rounded text-sm ${
                    health.rentman.status === 'up' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {health.rentman.status.toUpperCase()}
                  </div>
                  <div className="text-sm text-gray-600">
                    Response Time: {health.rentman.responseTime}ms
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-medium mb-4">Cache System</h3>
                <div className="space-y-2">
                  <div className={`inline-block px-2 py-1 rounded text-sm ${
                    health.cache.status === 'up' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {health.cache.status.toUpperCase()}
                  </div>
                  <div className="text-sm text-gray-600">
                    Hit Rate: {(health.cache.hitRate * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-medium mb-4">Server</h3>
                <div className="space-y-2">
                  <div className="inline-block px-2 py-1 rounded text-sm bg-green-100 text-green-800">
                    {health.server.status.toUpperCase()}
                  </div>
                  <div className="text-sm text-gray-600">
                    Uptime: {formatUptime(health.server.uptime)}
                  </div>
                  <div className="text-sm text-gray-600">
                    Memory: {formatBytes(health.server.memory.rss)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}