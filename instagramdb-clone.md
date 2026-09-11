# Instagram Database Clone > Schema Design

## Overview

This guide walks through designing a database schema for an Instagram clone, **starting from business requirements** and working toward a complete schema. Learn how to think through requirements, identify entities, determine relationships, and make informed design decisions.

---

## Part 1: Understanding Business Requirements

Before writing any SQL, we need to understand **what the application needs to do** and **how users will interact with it**.

### User Stories & Requirements

Let's gather the functional requirements:

#### 1. User Management

**User Story:** "As a new visitor, I want to create an account so I can share photos with others"

**Requirements:**

- Users must be able to register with a unique username
- System needs to track when each user joined
- Each user must have a unique identifier

**Business Rules:**

- Usernames must be unique (no duplicates)
- Username cannot be changed after registration (business decision)
- Need to track account creation date for loyalty programs

---

#### 2. Photo Sharing

**User Story:** "As a user, I want to upload and share photos so others can see my content"

**Requirements:**

- Users can upload multiple photos
- Each photo must be associated with the user who uploaded it
- System needs to store the photo location/URL
- Track when each photo was posted

**Business Rules:**

- Each photo belongs to exactly ONE user
- Users can upload unlimited photos
- Photos cannot exist without a user (if user deleted, what happens to photos?)
- Need timestamps for displaying "2 hours ago" etc.

**Key Questions:**

- ❓ Can multiple users own the same photo? **No** → One-to-Many relationship
- ❓ Should photos be kept if user account is deleted? **Business decision needed**

---

#### 3. Commenting System

**User Story:** "As a user, I want to comment on photos to engage with other users"

**Requirements:**

- Users can leave text comments on any photo
- Each comment needs to show who wrote it and which photo it's on
- Track when comments were posted
- Comments should be ordered by time

**Business Rules:**

- A user can comment multiple times on the same photo
- A photo can have unlimited comments
- Comments belong to both a user AND a photo

**Key Questions:**

- ❓ Can users edit/delete their comments? **Future feature**
- ❓ Should we allow nested replies? **Not in v1** → Keeps schema simpler

**Relationship Analysis:**

- One user → Many comments (One-to-Many)
- One photo → Many comments (One-to-Many)
- This creates a **triangle relationship**: Users ↔ Comments ↔ Photos

---

#### 4. Like System

**User Story:** "As a user, I want to like photos to show appreciation"

**Requirements:**

- Users can like any photo
- Users should only be able to like a photo once (no duplicate likes)
- System must track who liked which photo
- Need to count total likes per photo
- Track when the like happened

**Business Rules:**

- One user can like many photos
- One photo can be liked by many users
- **CRITICAL:** User cannot like the same photo twice

**Key Questions:**

- ❓ Can users unlike? **Yes** → Need ability to delete
- ❓ Do we need an auto-increment ID for likes? **No** → Composite key is sufficient
- ❓ What makes a like unique? **The combination of user + photo**

**Relationship Analysis:**

- This is a **Many-to-Many** relationship
- Needs a junction/join table
- Primary key = composite of (user_id, photo_id)

- Like: User + Photo Id with junction Table
- Composite: both id > enough > no unique attr filed like comment
- M:M

---

#### 5. Follow System (Social Graph)

**User Story:** "As a user, I want to follow other users to see their content in my feed

**Requirements:**

- Users can follow other users
- Users can be followed by other users
- Track when the follow relationship started
- A user cannot follow the same person twice

**Business Rules:**

- Following is one-directional (I follow you ≠ you follow me)
- Users cannot follow themselves
- A user can follow many users
- A user can be followed by many users

**Key Questions:**

- ❓ Is this a self-referential relationship? **Yes** → Both sides reference the same users table
- ❓ What do we call the two sides? **Follower** (who follows) and **Followee** (being followed)
- ❓ Do we need separate IDs? **No** → Composite key (follower_id, followee_id)

**Relationship Analysis:**

- This is a **self-referential Many-to-Many** relationship
- User table references itself twice
- Junction table needed with two foreign keys to users table

---

#### 6. Hashtag/Tagging System

**User Story:** "As a user, I want to add hashtags to photos so people can discover my content"

**Requirements:**

- Users can add multiple tags to a photo
- The same tag can be used on multiple photos
- Users should be able to search/filter by tags
- Track trending tags (most used)

**Business Rules:**

- A photo can have 0 to N tags
- A tag can be used on many photos
- Tag names should not be duplicated in database
- Need to track tag usage count for trending

**Key Questions:**

- ❓ How should we store tags? **Three approaches exist**
- ❓ Do we need tag metadata (creation date, usage count)? **Yes**
- ❓ Can same tag be added to photo twice? **No**

**Relationship Analysis:**

- This is **Many-to-Many** relationship
- Need to compare 3 different design approaches
- Trade-offs between simplicity vs. scalability

---

## Part 2: Entity Identification & Data Modeling

Now that we understand the requirements, let's identify our **entities** (things that will become tables).

### Identifying Entities

| Business Concept | Is it an Entity? | Why?                                                     |
| ---------------- | ---------------- | -------------------------------------------------------- |
| User             | ✅ YES           | Independent object with attributes, many per system      |
| Photo            | ✅ YES           | Independent object with attributes, many per system      |
| Comment          | ✅ YES           | Independent object with attributes, many per system      |
| Like             | ✅ MAYBE         | More of a relationship than entity, no unique attributes |
| Follow           | ✅ MAYBE         | More of a relationship, just connects two users          |
| Tag              | ✅ YES           | Can exist independently, reusable across photos          |
| Tag on Photo     | ✅ MAYBE         | Junction to connect tags with photos                     |

### Entity Relationships

Let's map out how entities relate:

```
USERS
  ↓ (one user can have many photos)
PHOTOS
  ↓ (one photo can have many comments)
COMMENTS

USERS → PHOTOS (One-to-Many: user owns photos)
USERS → COMMENTS (One-to-Many: user writes comments)
PHOTOS → COMMENTS (One-to-Many: photo has comments)

USERS ↔ PHOTOS (Many-to-Many: users like photos) → LIKES table
USERS ↔ USERS (Many-to-Many: users follow users) → FOLLOWS table
PHOTOS ↔ TAGS (Many-to-Many: photos have tags) → PHOTO_TAGS table
```

### Choosing Primary Keys

For each entity, decide on the primary key:

| Entity     | Primary Key Strategy                 | Reasoning                                 |
| ---------- | ------------------------------------ | ----------------------------------------- |
| Users      | Auto-increment ID                    | Users will be referenced by many tables   |
| Photos     | Auto-increment ID                    | Photos will be referenced by many tables  |
| Comments   | Auto-increment ID                    | May want to reference individual comments |
| Likes      | Composite (user_id, photo_id)        | The combination itself is unique          |
| Follows    | Composite (follower_id, followee_id) | The combination itself is unique          |
| Tags       | Auto-increment ID                    | Tags will be reused across photos         |
| Photo_Tags | Composite (photo_id, tag_id)         | The combination itself is unique          |

**Key Principle:** Use composite keys for junction tables in Many-to-Many relationships.

---

## Part 3: Schema Design (From Requirements to Tables)

Now let's translate our requirements into actual database tables.

### Design Principles Applied

1. **Normalization:** Avoid data duplication
2. **Referential Integrity:** Use foreign keys
3. **Constraints:** Enforce business rules at database level
4. **Timestamps:** Track when records created (audit trail)
5. **Unique Constraints:** Prevent invalid duplicates

### 1. Users Table

```sql
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

**Fields:**

- `id` - Primary key
- `username` - Unique username
- `created_at` - Account creation timestamp

---

### 2. Photos Table

```sql
CREATE TABLE photos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    image_url VARCHAR(255) NOT NULL,
    user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY(user_id) REFERENCES users(id)
);
```

**Fields:**

- `id` - Primary key
- `image_url` - URL/path to the image
- `user_id` - Foreign key to users table
- `created_at` - Photo upload timestamp

---

### 3. Comments Table

```sql
CREATE TABLE comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    comment_text VARCHAR(255) NOT NULL,
    user_id INT NOT NULL,
    photo_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(photo_id) REFERENCES photos(id)
);
```

**Fields:**

- `id` - Primary key
- `comment_text` - The comment content
- `user_id` - Foreign key to users table
- `photo_id` - Foreign key to photos table
- `created_at` - Comment creation timestamp

---

### 4. Likes Table

```sql
CREATE TABLE likes (
    user_id INT NOT NULL,
    photo_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(photo_id) REFERENCES photos(id),
    PRIMARY KEY(user_id, photo_id)
);
```

**Fields:**

- `user_id` - Foreign key to users table
- `photo_id` - Foreign key to photos table
- `created_at` - Like timestamp
- **Composite Primary Key** - (user_id, photo_id) prevents duplicate likes

---

### 5. Follows Table (Followers/Followees)

```sql
CREATE TABLE follows (
    follower_id INT NOT NULL,
    followee_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY(follower_id) REFERENCES users(id),
    FOREIGN KEY(followee_id) REFERENCES users(id),
    PRIMARY KEY(follower_id, followee_id)
);
```

**Fields:**

- `follower_id` - User who is following
- `followee_id` - User being followed
- `created_at` - Follow timestamp
- **Composite Primary Key** - (follower_id, followee_id)

#### Example Follows Data:

| FOLLOWER_ID | FOLLOWEE_ID | CREATED_AT |
| ----------- | ----------- | ---------- |
| 3           | 2           | 2017-03-03 |
| 3           | 1           | 2017-04-04 |
| 2           | 3           | 2017-05-05 |

This means:

- User 3 (ColtSteele) follows User 2 (BlueCat)
- User 3 (ColtSteele) follows User 1 (Tommy)
- User 2 (BlueCat) follows User 3 (ColtSteele)

---

## Hashtags/Tags Implementation

There are **3 popular solutions** for implementing tags:

### Solution 1: Tags as String in Photos Table

```sql
CREATE TABLE photos (
    id INT,
    image_url VARCHAR(255),
    caption VARCHAR(255),
    tags VARCHAR(255)
);
```

**Example Data:**

| id  | image_url    | caption    | tags                          |
| --- | ------------ | ---------- | ----------------------------- |
| 1   | '/ksjd97123' | 'My cat'   | '#cat#pets#animals#cute#omg'  |
| 2   | '/098fsdskj' | 'My meal'  | '#microwave#sadfood#gross'    |
| 3   | '/87hghjkd'  | 'A Selfie' | '#smile#ego#cute#srrynotsrry' |

**Pros:**

- ✅ Super easy to implement

**Cons:**

- ❌ Limited number of tags can be stored
- ❌ Have to be careful with searching
- ❌ Cannot store additional information about tags

---

### Solution 2: Separate Tags Column with Photo ID

Two tables: **Photos** and **Tags**

**Photos Table:**

| id  | image_url    | caption    |
| --- | ------------ | ---------- |
| 1   | '/ksjd97123' | 'My cat'   |
| 2   | '/098fsdskj' | 'My meal'  |
| 3   | '/87hghjkd'  | 'A Selfie' |

**Tags Table:**

| tag_name     | photo_id |
| ------------ | -------- |
| '#cute'      | 1        |
| '#cute'      | 3        |
| '#microwave' | 2        |
| '#ego'       | 3        |
| '#smile'     | 3        |
| '#gross'     | 2        |

**Pros:**

- ✅ Unlimited number of tags

**Cons:**

- ❌ Slower than previous solution
- ❌ Duplicate tag names (storage inefficiency)

---

### Solution 3: Three-Table Design (Recommended)

Three tables: **Photos**, **Tags**, and **Photo_Tags** (junction table)

```sql
CREATE TABLE tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tag_name VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE photo_tags (
    photo_id INT NOT NULL,
    tag_id INT NOT NULL,
    FOREIGN KEY(photo_id) REFERENCES photos(id),
    FOREIGN KEY(tag_id) REFERENCES tags(id),
    PRIMARY KEY(photo_id, tag_id)
);
```

**Photos Table:**

| id  | image_url    | caption    |
| --- | ------------ | ---------- |
| 1   | '/ksjd97123' | 'My cat'   |
| 2   | '/098fsdskj' | 'My meal'  |
| 3   | '/87hghjkd'  | 'A Selfie' |

**Tags Table:**

| id  | tag_name     |
| --- | ------------ |
| 1   | '#cute'      |
| 2   | '#pets'      |
| 3   | '#microwave' |
| 4   | '#ego'       |
| 5   | '#smile'     |
| 6   | '#gross'     |

**Photo_Tags Table:**

| photo_id | tag_id |
| -------- | ------ |
| 1        | 1      |
| 1        | 2      |
| 2        | 3      |
| 2        | 6      |
| 3        | 1      |
| 3        | 4      |
| 3        | 5      |

**Pros:**

- ✅ Unlimited number of tags
- ✅ Can add additional information
- ✅ No duplicate tag names

**Cons:**

- ❌ More work when inserting/updating
- ❌ Have to worry about orphan records

---

## SQL Challenge Questions

Once you've inserted data, practice with these real-world scenarios:

### Challenge 1: Find the 5 Oldest Users

**Business Context:** Reward users who have been around the longest.

```sql
SELECT *
FROM users
ORDER BY created_at
LIMIT 5;
```

---

### Challenge 2: Most Popular Registration Day

**Business Context:** Figure out when to schedule an ad campaign. What day of the week do most users register on?

```sql
SELECT
    DAYNAME(created_at) AS day,
    COUNT(*) AS total
FROM users
GROUP BY day
ORDER BY total DESC
LIMIT 1;
```

---

### Challenge 3: Find Inactive Users

**Business Context:** Target inactive users with an email campaign. Find users who have never posted a photo.

```sql
SELECT username
FROM users
LEFT JOIN photos ON users.id = photos.user_id
WHERE photos.id IS NULL;
```

---

### Challenge 4: Most Likes on a Single Photo

**Business Context:** Contest to see who can get the most likes on a single photo. Who won?

```sql
SELECT
    username,
    photos.id,
    photos.image_url,
    COUNT(*) AS total_likes
FROM photos
INNER JOIN likes ON likes.photo_id = photos.id
INNER JOIN users ON photos.user_id = users.id
GROUP BY photos.id
ORDER BY total_likes DESC
LIMIT 1;
```

---

### Challenge 5: Average User Posts

**Business Context:** Investors want to know how many times the average user posts.

```sql
SELECT
    (SELECT COUNT(*) FROM photos) / (SELECT COUNT(*) FROM users) AS avg_posts_per_user;
```

---

### Challenge 6: Top 5 Most Used Hashtags

**Business Context:** A brand wants to know which hashtags to use in a post.

```sql
SELECT
    tags.tag_name,
    COUNT(*) AS total_usage
FROM photo_tags
JOIN tags ON photo_tags.tag_id = tags.id
GROUP BY tags.id
ORDER BY total_usage DESC
LIMIT 5;
```

---

### Challenge 7: Find Bot Accounts (Liked Every Photo)

**Business Context:** Detect bots. Find users who have liked every single photo on the site.

```sql
SELECT
    username,
    COUNT(*) AS num_likes
FROM users
INNER JOIN likes ON users.id = likes.user_id
GROUP BY likes.user_id
HAVING num_likes = (SELECT COUNT(*) FROM photos);
```

---

### Challenge 8: Find Users Who Never Commented

**Business Context:** Identify celebrity/lurker accounts. Find users who have never commented on a photo.

```sql
SELECT username
FROM users
LEFT JOIN comments ON users.id = comments.user_id
WHERE comments.id IS NULL;
```

---

### Challenge 9: MEGA CHALLENGE - Bot & Celebrity Percentage

**Business Context:** Are we overrun with bots and celebrity accounts? Find the percentage of users who have either never commented on a photo OR have commented on every photo.

```sql
SELECT
    tablecount.total_users AS 'Total Users',
    tablecount.inactive_users AS 'Inactive Users',
    (tablecount.inactive_users / tablecount.total_users * 100) AS 'Percentage'
FROM (
    SELECT
        COUNT(DISTINCT users.id) AS total_users,
        COUNT(DISTINCT no_comments.user_id) AS inactive_users
    FROM users
    LEFT JOIN (
        SELECT user_id
        FROM users
        LEFT JOIN comments ON users.id = comments.user_id
        WHERE comments.id IS NULL
    ) AS no_comments ON users.id = no_comments.user_id
) AS tablecount;
```

---

## Key Takeaways

1. **Normalize your data** - Use junction tables for many-to-many relationships
2. **Composite primary keys** - Prevent duplicate entries in likes and follows
3. **Foreign keys** - Maintain referential integrity
4. **Indexes** - Consider adding indexes on frequently queried columns
5. **Business logic** - SQL queries should answer real business questions

## Next Steps

1. Create the schema
2. Insert sample data
3. Practice all challenge queries
4. Optimize queries with indexes
5. Consider additional features (stories, direct messages, notifications)
