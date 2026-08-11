CREATE TABLE `event_ratings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` int NOT NULL,
	`deviceId` varchar(64) NOT NULL,
	`rating` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `event_ratings_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_ratings_event_device_unique` UNIQUE(`eventId`,`deviceId`)
);
--> statement-breakpoint
CREATE TABLE `gallery_favorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`galleryName` varchar(255) NOT NULL,
	`deviceId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gallery_favorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `gallery_favorites_gallery_device_unique` UNIQUE(`galleryName`,`deviceId`)
);
--> statement-breakpoint
