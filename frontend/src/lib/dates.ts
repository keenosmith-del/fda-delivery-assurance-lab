export const dateLabel = (value: string) => new Intl.DateTimeFormat('en', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
}).format(new Date(value)) + ' UTC';
