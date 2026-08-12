export type AvatarSource = 'custom' | 'google' | 'none'

export interface UserProfileResponse {
  displayName: string | null
  email: string | null
  providers: string[]
  createdAt: string
  avatarUrl: string | null
  avatarSource: AvatarSource
}
