/**
 * Dependency Injection Container
 * Simple DI container for managing service lifecycles and dependencies
 */

/**
 * Service constructor type
 */
type ServiceConstructor<T = any> = new (...args: any[]) => T;

/**
 * Service factory function type
 */
type ServiceFactory<T = any> = () => T | Promise<T>;

/**
 * Service lifecycle options
 */
interface ServiceOptions {
  singleton?: boolean;
  factory?: ServiceFactory;
  dependencies?: string[];
}

/**
 * Service registration entry
 */
interface ServiceRegistration {
  constructor?: ServiceConstructor;
  factory?: ServiceFactory;
  instance?: any;
  singleton: boolean;
  dependencies: string[];
  initialized: boolean;
}

/**
 * Simple Dependency Injection Container
 */
export class DIContainer {
  private services = new Map<string, ServiceRegistration>();
  private resolving = new Set<string>();

  /**
   * Register a service class
   */
  register<T>(
    name: string, 
    constructor: ServiceConstructor<T>, 
    options: ServiceOptions = {}
  ): void {
    this.services.set(name, {
      constructor,
      singleton: options.singleton ?? true,
      dependencies: options.dependencies ?? [],
      initialized: false
    });
  }

  /**
   * Register a service factory
   */
  registerFactory<T>(
    name: string,
    factory: ServiceFactory<T>,
    options: Omit<ServiceOptions, 'factory'> = {}
  ): void {
    this.services.set(name, {
      constructor: undefined,
      factory,
      singleton: options.singleton ?? true,
      dependencies: options.dependencies ?? [],
      initialized: false
    });
  }

  /**
   * Register a singleton instance
   */
  registerInstance<T>(name: string, instance: T): void {
    this.services.set(name, {
      constructor: undefined,
      factory: undefined,
      instance,
      singleton: true,
      dependencies: [],
      initialized: true
    });
  }

  /**
   * Resolve a service by name
   */
  async resolve<T>(name: string): Promise<T> {
    // Check for circular dependencies
    if (this.resolving.has(name)) {
      throw new Error(`Circular dependency detected: ${Array.from(this.resolving).join(' -> ')} -> ${name}`);
    }

    const registration = this.services.get(name);
    if (!registration) {
      throw new Error(`Service '${name}' not registered`);
    }

    // Return existing singleton instance
    if (registration.singleton && registration.instance) {
      return registration.instance;
    }

    this.resolving.add(name);

    try {
      let instance: T;

      // Resolve dependencies first
      const dependencies = await Promise.all(
        registration.dependencies.map(dep => this.resolve(dep))
      );

      // Create instance
      if (registration.factory) {
        instance = await registration.factory();
      } else if (registration.constructor) {
        instance = new registration.constructor(...dependencies);
      } else if (registration.instance) {
        instance = registration.instance;
      } else {
        throw new Error(`No constructor, factory, or instance for service '${name}'`);
      }

      // Store singleton instance
      if (registration.singleton) {
        registration.instance = instance;
        registration.initialized = true;
      }

      this.resolving.delete(name);
      return instance;
    } catch (error) {
      this.resolving.delete(name);
      throw error;
    }
  }

  /**
   * Check if a service is registered
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Get all registered service names
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear(): void {
    this.services.clear();
    this.resolving.clear();
  }

  /**
   * Initialize all registered services
   */
  async initializeAll(): Promise<void> {
    const serviceNames = this.getServiceNames();
    
    // Resolve all services to trigger initialization
    await Promise.all(
      serviceNames.map(name => this.resolve(name))
    );
  }

  /**
   * Get dependency graph for debugging
   */
  getDependencyGraph(): Record<string, string[]> {
    const graph: Record<string, string[]> = {};
    
    for (const [name, registration] of this.services) {
      graph[name] = registration.dependencies;
    }
    
    return graph;
  }
}

/**
 * Global container instance
 */
export const container = new DIContainer(); 