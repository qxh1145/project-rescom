export class PayosAvailability {
  private enabled = false;
  isCheckoutOpen(): boolean {
    return this.enabled;
  }
  open(): void {
    this.enabled = true;
  }
}
