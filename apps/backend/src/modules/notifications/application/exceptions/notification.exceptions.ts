export class NotificationNotFoundException extends Error {
  readonly code = 'NOTIFICATION_NOT_FOUND';

  constructor(message = 'Notification not found.') {
    super(message);
    this.name = 'NotificationNotFoundException';
  }
}
