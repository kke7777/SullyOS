export interface RecallSource {
    id: string;
    kind: 'event_box' | 'memory';
    name: string;
}

/** One batch after the existing selection and EventBox expansion. */
export interface RecallMaterial {
    originalText: string;
    memoryText: string;
    prefix: string;
    suffix: string;
    sources: RecallSource[];
}
