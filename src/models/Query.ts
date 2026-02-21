import mongoose, { Document, Schema } from 'mongoose';

// ─── Sub-document types ───────────────────────────────────────────────────────

export interface IImageAnalysis {
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  /** Raw HuggingFace classification results */
  hfResults: Array<{ label: string; score: number }>;
  /** Parsed top disease/condition */
  topPrediction: string;
  confidence: number;
}

export interface IChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: IImageAnalysis[];
  timestamp: Date;
}

export interface IQuery extends Document {
  _id: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId; // optional — support guest sessions too
  sessionId: string;
  title: string;
  messages: IChatMessage[];
  cropType?: string;
  location?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const ImageAnalysisSchema = new Schema<IImageAnalysis>(
  {
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    hfResults: [{ label: String, score: Number }],
    topPrediction: { type: String, default: 'Unknown' },
    confidence: { type: Number, default: 0 },
  },
  { _id: false }
);

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    images: [ImageAnalysisSchema],
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const QuerySchema = new Schema<IQuery>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    sessionId: { type: String, required: true, index: true },
    title: { type: String, default: 'New Consultation' },
    messages: [ChatMessageSchema],
    cropType: { type: String, trim: true },
    location: { type: String, trim: true },
  },
  { timestamps: true }
);

// Auto-generate title from first user message
QuerySchema.pre('save', function (next) {
  if (this.isNew && this.messages.length > 0) {
    const firstUserMsg = this.messages.find((m) => m.role === 'user');
    if (firstUserMsg) {
      this.title = firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? '…' : '');
    }
  }
  next();
});

export const Query = mongoose.model<IQuery>('Query', QuerySchema);