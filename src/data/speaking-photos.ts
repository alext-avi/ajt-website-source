export interface SpeakingPhoto {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
}

export const speakingPhotos: Record<'stage', SpeakingPhoto> = {
  stage: {
    src: '/images/events/all-things-open-2026/alexander-thomas-on-stage.jpg',
    alt: 'Alexander Thomas presenting the lightning talk Your Next Power User Won’t Learn Your UI at All Things Open 2026.',
    caption:
      'All Things Open 2026 · “Your Next Power User Won’t Learn Your UI”',
    width: 1280,
    height: 853,
  },
};

export const talkPhotoGalleries: Record<string, SpeakingPhoto[]> = {
  'your-next-power-user': [speakingPhotos.stage],
};
