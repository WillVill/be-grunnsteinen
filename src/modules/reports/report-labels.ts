/** Norwegian labels for reports. Kept free of imports so the email service can use them without a cycle. */
export const TYPE_LABELS: Record<string, string> = {
  post: 'Oppslag',
  comment: 'Kommentar',
  message: 'Melding',
};

export const REASON_LABELS: Record<string, string> = {
  spam: 'Spam eller reklame',
  harassment: 'Trakassering eller mobbing',
  inappropriate: 'Upassende innhold',
  other: 'Annet',
};
