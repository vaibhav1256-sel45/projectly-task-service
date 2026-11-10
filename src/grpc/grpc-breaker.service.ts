import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { lastValueFrom, Observable } from 'rxjs';

const UNAVAILABLE = 14; // gRPC code: the other service cannot be reached

// Runs a gRPC call through a circuit breaker. Every `name` gets its own breaker.
//   await this.grpc.call('project.getMembersId', () => this.projectService.getMembersId({ project_id }));
@Injectable()
export class GrpcBreaker {
  private breakers = new Map<string, CircuitBreaker>();

  async call<T>(name: string, request: () => Observable<T>): Promise<T> {
    if (!this.breakers.has(name)) {
      this.breakers.set(
        name,
        new CircuitBreaker((req: () => Observable<any>) => lastValueFrom(req()), {
          timeout: 3000, // slower than 3s = failed
          errorThresholdPercentage: 50, // open when half of the calls fail
          volumeThreshold: 5, // but only after 5 calls
          resetTimeout: 15000, // try again after 15s
          // any other gRPC error (NOT_FOUND...) means the service answered, so it is not a failure
          errorFilter: (err: any) => typeof err?.code === 'number' && err.code !== UNAVAILABLE,
        }),
      );
    }

    try {
      return (await this.breakers.get(name)!.fire(request)) as T;
    } catch (err: any) {
      if (err.code === 'EOPENBREAKER' || err.code === 'ETIMEDOUT' || err.code === UNAVAILABLE) {
        throw new ServiceUnavailableException(`Service unavailable (${name}), please try again`);
      }
      throw err; // the other service's own error, unchanged
    }
  }
}
