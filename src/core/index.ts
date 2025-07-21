/**
 * Core Application Module
 * 
 * Core orchestration and lifecycle management for the Discord Claude bot:
 * - Application lifecycle management
 * - Dependency injection container
 * - Service registration and resolution
 * - Startup and shutdown coordination
 * 
 * @example
 * ```typescript
 * import { app, container } from '@/core';
 * 
 * // Start the application
 * await app.start();
 * 
 * // Register and resolve services
 * container.register('myService', MyServiceClass);
 * const service = await container.resolve<MyServiceClass>('myService');
 * ```
 */

// Export application orchestrator
export { Application, app } from './application';

// Export dependency injection
export { DIContainer, container } from './dependency-injection'; 