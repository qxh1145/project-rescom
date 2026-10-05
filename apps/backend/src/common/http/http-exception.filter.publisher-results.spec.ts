import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import {
  FormVersionNotFoundException,
  InvalidResultsCursorException,
  PublisherAnalyticsLimitExceededException,
} from '../../modules/forms/application/exceptions/form.exceptions';

/** Story IR.4a: the three publisher-results error mappings (404 / 400 / 422). */
describe('HttpExceptionFilter: Story IR.4a publisher results', () => {
  function run(exception: unknown) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    new HttpExceptionFilter().catch(exception, {
      switchToHttp: () => ({
        getResponse: () => ({ status, headersSent: false }),
        getRequest: () => ({}),
      }),
    } as unknown as ArgumentsHost);
    return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
  }

  it('maps FORM_VERSION_NOT_FOUND to 404', () => {
    const { status, body } = run(new FormVersionNotFoundException());
    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body.error.code).toBe('FORM_VERSION_NOT_FOUND');
  });

  it('maps INVALID_CURSOR to 400', () => {
    const { status, body } = run(new InvalidResultsCursorException());
    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.error.code).toBe('INVALID_CURSOR');
  });

  it('maps PUBLISHER_ANALYTICS_LIMIT_EXCEEDED to 422 with { totalResponses, limit }', () => {
    const { status, body } = run(
      new PublisherAnalyticsLimitExceededException(5001, 5000),
    );
    expect(status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(body.error.code).toBe('PUBLISHER_ANALYTICS_LIMIT_EXCEEDED');
    expect(body.error.details).toEqual({ totalResponses: 5001, limit: 5000 });
  });
});
